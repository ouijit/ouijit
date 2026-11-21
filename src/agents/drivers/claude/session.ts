import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  filterEscalatingDefaultMode,
  query,
  resolveSettings,
  type CanUseTool,
  type EffortLevel,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import { deferredProcess } from '../../process';
import type { DriverContext, DriverSession, DriverSink, UserInput } from '../../driver';
import type { ChatAnswer, ChatCapabilities, ChatOption, RequestOption } from '../../model';
import { USER_PREFIX, str, toolTitle, type Json } from './transcript';
import { ClaudeStream, type ClaudeConversation } from './stream';
import { importHistory } from './history';

const CAPABILITIES: ChatCapabilities = {
  images: true,
  steer: true,
  queue: true,
  interrupt: true,
  models: true,
  effort: true,
  modes: true,
  commands: true,
  fork: true,
  rewind: true,
  compact: true,
};

const MODES: ChatOption[] = [
  {
    id: 'default',
    label: 'Ask',
    description: 'Ask before edits and commands your settings do not allow',
    latitude: 1,
  },
  { id: 'acceptEdits', label: 'Accept edits', description: 'Edit files without asking', latitude: 2 },
  { id: 'plan', label: 'Plan', description: 'Plan without changing anything', latitude: 0 },
  { id: 'bypassPermissions', label: 'Skip permissions', description: 'Run everything without asking', latitude: 4 },
];

const AUTO_MODE: ChatOption = {
  id: 'auto',
  label: 'Auto',
  description: 'A classifier approves safe actions and asks about the rest',
  latitude: 3,
};

const SETTING_SOURCES: SettingSource[] = ['user', 'project', 'local'];

const EFFORTS: ChatOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
];

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private ended = false;

  push(item: SDKUserMessage): void {
    if (this.ended) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  end(): void {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

async function imageBlock(path: string, mimeType: string): Promise<Json> {
  const data = await readFile(path);
  return { type: 'image', source: { type: 'base64', media_type: mimeType, data: data.toString('base64') } };
}

async function messageContent(input: UserInput): Promise<Json[]> {
  const blocks: Json[] = [];
  const mentions = input.attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'));
  const text = [input.text, ...mentions.map((attachment) => `@${attachment.path}`)].filter(Boolean).join('\n');
  if (text) blocks.push({ type: 'text', text });
  for (const attachment of input.attachments) {
    if (attachment.mimeType.startsWith('image/')) blocks.push(await imageBlock(attachment.path, attachment.mimeType));
  }
  return blocks;
}

function uuidOf(nodeId: string): string {
  return nodeId.startsWith(USER_PREFIX) ? nodeId.slice(USER_PREFIX.length) : nodeId;
}

const APPROVAL: RequestOption[] = [
  { id: 'allow', label: 'Allow', kind: 'allow_once' },
  { id: 'always', label: 'Always allow', kind: 'allow_always' },
  { id: 'deny', label: 'Deny', kind: 'reject_once' },
];

const PLAN_APPROVAL: RequestOption[] = [
  { id: 'allow', label: 'Approve plan', kind: 'allow_once' },
  { id: 'deny', label: 'Keep planning', kind: 'reject_once' },
];

export class ClaudeSession implements DriverSession {
  readonly capabilities = CAPABILITIES;
  modeMidTurn = false;
  private q: Query | null = null;
  private input: InputQueue | null = null;
  private loop: Promise<void> | null = null;
  private effort: EffortLevel | undefined;
  private closing = false;
  private readonly conversation: ClaudeConversation;
  private readonly stream: ClaudeStream;

  constructor(
    private readonly context: DriverContext,
    private readonly binary: string,
  ) {
    this.conversation = {
      sessionId: context.resume?.agentSessionId ?? null,
      mode: (context.mode as PermissionMode | undefined) ?? null,
      lastAssistantUuid: null,
      before: new Map(),
      stopping: false,
    };
    this.stream = new ClaudeStream(context.sink, this.conversation);
  }

  private get sink(): DriverSink {
    return this.context.sink;
  }

  async open(): Promise<void> {
    if (this.context.resume) {
      await importHistory(this.context.resume.agentSessionId, this.context.cwd, this.sink, this.conversation);
    }
    if (!this.conversation.mode) {
      this.conversation.mode = await this.startingMode();
      if (this.conversation.mode) this.sink.session({ mode: this.conversation.mode });
    }
    this.begin(this.context.resume?.fork ? { forkSession: true } : {});
    this.sink.session({ modes: MODES, efforts: EFFORTS });
  }

  /**
   * Given no mode, an SDK session starts in default even where the terminal
   * starts in auto, so auto is asked for unless the settings name a mode.
   */
  private async startingMode(): Promise<PermissionMode | null> {
    try {
      const resolved = await resolveSettings({ cwd: this.context.cwd, settingSources: SETTING_SOURCES });
      return filterEscalatingDefaultMode(resolved).permissions?.defaultMode ? null : 'auto';
    } catch (error) {
      this.sink.log('claude settings resolve failed', { error: String(error) });
      return null;
    }
  }

  private options(extra: Partial<Options>): Options {
    const instructions = this.context.instructions;
    const canUseTool: CanUseTool = (toolName, input, options) => this.permission(toolName, input, options);
    return {
      cwd: this.context.cwd,
      pathToClaudeCodeExecutable: this.binary,
      spawnClaudeCodeProcess: (spawn) => deferredProcess(this.context.spawn({ ...spawn, env: addedEnv(spawn.env) })),
      settingSources: SETTING_SOURCES,
      systemPrompt: { type: 'preset', preset: 'claude_code', ...(instructions && { append: instructions }) },
      includePartialMessages: true,
      // Without it a thinking block arrives with no text, so there is nothing to show.
      extraArgs: { 'thinking-display': 'summarized' },
      enableFileCheckpointing: true,
      // Makes skip-permissions choosable, as `--allow-dangerously-skip-permissions`
      // does in the terminal; the session still starts in the user's own mode.
      allowDangerouslySkipPermissions: true,
      canUseTool,
      ...(this.effort && { effort: this.effort }),
      ...(this.conversation.mode && { permissionMode: this.conversation.mode }),
      ...(this.conversation.sessionId && { resume: this.conversation.sessionId }),
      ...extra,
    };
  }

  private begin(extra: Partial<Options>): void {
    this.input = new InputQueue();
    this.stream.restarted();
    const q = query({ prompt: this.input, options: this.options(extra) });
    this.q = q;
    this.loop = this.consume(q);
    void this.loadMetadata(q);
  }

  private async loadMetadata(q: Query): Promise<void> {
    try {
      const [commands, models] = await Promise.all([q.supportedCommands(), q.supportedModels()]);
      this.sink.session({
        commands: commands.map((command) => ({
          name: command.name,
          description: command.description,
          argumentHint: command.argumentHint || undefined,
        })),
        models: models.map((model) => ({
          id: model.value,
          label: model.displayName,
          description: model.description,
          standsFor: models.find(
            (other) => other !== model && other.resolvedModel && other.resolvedModel === model.resolvedModel,
          )?.displayName,
        })),
        modes: models.some((model) => model.supportsAutoMode)
          ? [...MODES.slice(0, 3), AUTO_MODE, ...MODES.slice(3)]
          : MODES,
        ...this.stream.modelPatch(models),
      });
    } catch (error) {
      this.sink.log('claude metadata load failed', { error: String(error) });
    }
  }

  private async consume(q: Query): Promise<void> {
    try {
      for await (const message of q) this.stream.handle(message);
      if (!this.closing && this.q === q)
        this.sink.session({ status: 'exited', statusDetail: 'Claude ended the session' });
    } catch (error) {
      if (!this.closing && this.q === q) {
        this.sink.session({ status: 'error', statusDetail: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private async permission(
    toolName: string,
    input: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    const toolCallId = `claude-tool-${options.toolUseID}`;
    if (toolName === 'AskUserQuestion') {
      const questions = Array.isArray(input.questions) ? (input.questions as Json[]) : [];
      const answer = await this.sink.ask({
        id: `claude-ask-${options.toolUseID}`,
        parentId: null,
        request: 'questions',
        title: questions.length === 1 ? String(questions[0].question) : 'Claude has questions',
        toolCallId,
        options: [],
        questions: questions.map((question, index) => ({
          id: String(index),
          question: String(question.question),
          header: str(question.header),
          options: Array.isArray(question.options)
            ? (question.options as Json[]).map((option) => ({
                label: String(option.label),
                description: str(option.description),
              }))
            : [],
          multiSelect: question.multiSelect === true,
          allowText: true,
        })),
      });
      if (answer.kind !== 'answers') return { behavior: 'deny', message: 'The user dismissed the question.' };
      const answers: Record<string, string> = {};
      questions.forEach((question, index) => {
        answers[String(question.question)] = (answer.answers[String(index)] ?? []).join(', ');
      });
      return { behavior: 'allow', updatedInput: { ...input, answers } };
    }

    const isPlan = toolName === 'ExitPlanMode';
    const answer = await this.sink.ask({
      id: `claude-approval-${options.toolUseID}`,
      parentId: null,
      request: 'approval',
      title: isPlan ? 'Approve the plan?' : (options.title ?? toolTitle(toolName, input)),
      detail: isPlan ? str(input.plan) : (options.description ?? options.decisionReason),
      toolCallId,
      options:
        isPlan || !options.suggestions?.length
          ? isPlan
            ? PLAN_APPROVAL
            : APPROVAL.filter((o) => o.id !== 'always')
          : APPROVAL,
      questions: [],
    });
    if (answer.kind === 'cancel') this.conversation.stopping = true;
    return permissionResult(answer, input, options.suggestions);
  }

  private async userMessage(input: UserInput, priority?: 'next' | 'later'): Promise<void> {
    if (!this.input) throw new Error('Claude is not running');
    const uuid = uuidOf(input.id);
    this.conversation.before.set(input.id, this.conversation.lastAssistantUuid);
    this.input.push({
      type: 'user',
      message: { role: 'user', content: (await messageContent(input)) as never },
      parent_tool_use_id: null,
      uuid: uuid as SDKUserMessage['uuid'],
      session_id: this.conversation.sessionId ?? '',
      ...(priority && { priority }),
    } as SDKUserMessage);
  }

  async prompt(input: UserInput): Promise<void> {
    await this.userMessage(input);
  }

  async send(input: UserInput, delivery: 'steer' | 'queue'): Promise<void> {
    await this.userMessage(input, delivery === 'steer' ? 'next' : 'later');
  }

  async interrupt(): Promise<void> {
    this.conversation.stopping = true;
    await this.q?.interrupt();
  }

  async setModel(model: string): Promise<void> {
    await this.q?.setModel(model);
  }

  async setMode(mode: string): Promise<void> {
    this.conversation.mode = mode as PermissionMode;
    await this.q?.setPermissionMode(this.conversation.mode);
  }

  /** Effort is fixed for the life of a query, so a change restarts it on the same conversation. */
  async setEffort(effort: string): Promise<void> {
    this.effort = effort as EffortLevel;
    await this.restart({});
  }

  async rewind(userMessageId: string): Promise<void> {
    const uuid = uuidOf(userMessageId);
    try {
      await this.q?.rewindFiles(uuid);
    } catch (error) {
      this.sink.log('claude file rewind failed', { error: String(error) });
    }
    const keep = this.conversation.before.get(userMessageId) ?? null;
    if (keep) {
      await this.restart({ resumeSessionAt: keep });
    } else {
      this.conversation.sessionId = null;
      await this.restart({});
    }
  }

  async stopBackground(taskId: string): Promise<void> {
    await this.q?.stopTask(taskId);
  }

  async backgroundOutput(taskId: string): Promise<string> {
    // At runtime the query has it, though the SDK's types leave it out.
    const q = this.q as (Query & { getTaskOutput?(id: string): Promise<{ output: string }> }) | null;
    return (await q?.getTaskOutput?.(taskId))?.output ?? '';
  }

  async compact(): Promise<void> {
    await this.userMessage({ id: `${USER_PREFIX}${randomUUID()}`, text: '/compact', attachments: [] });
  }

  private async restart(extra: Partial<Options>): Promise<void> {
    const previous = this.q;
    this.q = null;
    this.input?.end();
    previous?.close();
    await this.loop;
    this.begin(extra);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.input?.end();
    this.q?.close();
    await this.loop;
  }
}

/** The SDK hands its spawn hook the whole environment; only what it added over ours should reach the agent. */
function addedEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const added: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] !== value) added[key] = value;
  }
  return added;
}

function permissionResult(
  answer: ChatAnswer,
  input: Record<string, unknown>,
  suggestions: Parameters<CanUseTool>[2]['suggestions'],
): PermissionResult {
  if (answer.kind === 'option' && (answer.optionId === 'allow' || answer.optionId === 'always')) {
    return {
      behavior: 'allow',
      updatedInput: input,
      ...(answer.optionId === 'always' && suggestions && { updatedPermissions: suggestions }),
    };
  }

  const message = answer.kind === 'option' && answer.message ? answer.message : 'The user declined this.';
  return { behavior: 'deny', message, ...(answer.kind === 'cancel' && { interrupt: true }) };
}
