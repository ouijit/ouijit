import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  getSessionMessages,
  query,
  type CanUseTool,
  type EffortLevel,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { binaryVersion, compareVersions, resolveAgentBinary } from '../binaries';
import { deferredProcess } from '../process';
import type { AgentDriver, DriverContext, DriverSession, DriverSink, UserInput } from '../driver';
import type {
  ChatAnswer,
  ChatCapabilities,
  ChatNode,
  ChatOption,
  FileChange,
  PlanEntry,
  RequestOption,
  ToolCallNode,
  ToolKind,
} from '../model';

/** The Agent SDK this build ships needs a CLI at least this new for `canUseTool` and session state events. */
const CLAUDE_MIN_VERSION = '2.1.200';

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
  { id: 'default', label: 'Ask', description: 'Ask before edits and commands your settings do not allow' },
  { id: 'acceptEdits', label: 'Accept edits', description: 'Edit files without asking' },
  { id: 'plan', label: 'Plan', description: 'Plan without changing anything' },
];

const EFFORTS: ChatOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
];

type Json = Record<string, unknown>;
type ContentBlock = Json & { type: string };

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

function toolKind(name: string): ToolKind {
  if (name.startsWith('mcp__')) return 'mcp';
  switch (name) {
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
      return 'command';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit';
    case 'Read':
      return 'read';
    case 'Glob':
    case 'Grep':
      return 'search';
    case 'WebFetch':
    case 'WebSearch':
      return 'fetch';
    case 'Task':
    case 'Agent':
      return 'subagent';
    default:
      return 'other';
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toolTitle(name: string, input: Json): string {
  const file = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
  switch (name) {
    case 'Bash':
      return str(input.description) ?? str(input.command) ?? 'Run a command';
    case 'Read':
      return `Read ${file ?? 'a file'}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Edit ${file ?? 'a file'}`;
    case 'Write':
      return `Write ${file ?? 'a file'}`;
    case 'Glob':
      return `Find ${str(input.pattern) ?? 'files'}`;
    case 'Grep':
      return `Search for ${str(input.pattern) ?? 'text'}`;
    case 'WebFetch':
      return `Fetch ${str(input.url) ?? 'a page'}`;
    case 'WebSearch':
      return `Search the web for ${str(input.query) ?? ''}`.trim();
    case 'Task':
    case 'Agent':
      return str(input.description) ?? 'Run a subagent';
    default:
      if (name.startsWith('mcp__')) {
        const [, server, tool] = name.split('__');
        return `${server}: ${tool ?? ''}`.trim();
      }
      return name;
  }
}

function toolFiles(name: string, input: Json): FileChange[] {
  const file = str(input.file_path) ?? str(input.notebook_path);
  if (!file || toolKind(name) !== 'edit') return [];
  return [{ path: file, change: name === 'Write' ? 'add' : 'modify' }];
}

interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

function unifiedDiff(path: string, hunks: StructuredPatchHunk[]): string {
  const body = hunks.map(
    (hunk) => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`,
  );
  return `--- a/${path}\n+++ b/${path}\n${body.join('\n')}`;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: Json) => (part.type === 'text' ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

function todoEntries(input: Json): PlanEntry[] {
  const todos = Array.isArray(input.todos) ? (input.todos as Json[]) : [];
  return todos.map((todo) => ({
    text: str(todo.content) ?? str(todo.activeForm) ?? '',
    status: todo.status === 'completed' ? 'completed' : todo.status === 'in_progress' ? 'in_progress' : 'pending',
  }));
}

function userText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: Json) => part.type === 'text')
    .map((part: Json) => String(part.text ?? ''))
    .join('\n');
}

const USER_PREFIX = 'user-';

/**
 * Translates Claude's message stream into transcript nodes. Ids derive from
 * what the CLI writes to its session file — the API message id and the
 * block's place in it, the tool_use id, the user message uuid — so the live
 * stream and a history import produce the same nodes.
 */
class ClaudeTranscript {
  private blockOrdinals = new Map<string, number>();
  private readonly tools = new Map<string, ToolCallNode>();
  private plan: PlanEntry[] = [];
  private tasks = new Map<string, PlanEntry>();

  constructor(private readonly sink: Pick<DriverSink, 'node' | 'append'>) {}

  private parent(parentToolUseId: string | null | undefined): string | null {
    return parentToolUseId ? `claude-tool-${parentToolUseId}` : null;
  }

  streamEvent(event: Json, parentToolUseId: string | null, messageIds: Map<string | null, string>): void {
    const parentId = this.parent(parentToolUseId);
    switch (event.type) {
      case 'message_start': {
        const message = event.message as Json;
        messageIds.set(parentToolUseId, String(message.id));
        return;
      }
      case 'content_block_start': {
        const messageId = messageIds.get(parentToolUseId);
        const block = event.content_block as ContentBlock;
        if (!messageId) return;
        const id = `claude-${messageId}-${String(event.index)}`;
        if (block.type === 'text') {
          this.sink.node({
            id,
            kind: 'assistant_message',
            parentId,
            createdAt: Date.now(),
            text: '',
            status: 'running',
          });
        } else if (block.type === 'thinking') {
          this.sink.node({ id, kind: 'reasoning', parentId, createdAt: Date.now(), text: '', status: 'running' });
        }
        return;
      }
      case 'content_block_delta': {
        const messageId = messageIds.get(parentToolUseId);
        const delta = event.delta as Json;
        if (!messageId) return;
        const id = `claude-${messageId}-${String(event.index)}`;
        if (delta.type === 'text_delta') this.sink.append(id, 'text', String(delta.text ?? ''));
        else if (delta.type === 'thinking_delta') this.sink.append(id, 'text', String(delta.thinking ?? ''));
        return;
      }
    }
  }

  assistant(message: Json, parentToolUseId: string | null): void {
    const parentId = this.parent(parentToolUseId);
    const messageId = String(message.id);
    const content = Array.isArray(message.content) ? (message.content as ContentBlock[]) : [];
    for (const block of content) {
      const ordinal = this.blockOrdinals.get(messageId) ?? 0;
      this.blockOrdinals.set(messageId, ordinal + 1);
      const id = `claude-${messageId}-${ordinal}`;
      const createdAt = Date.now();
      if (block.type === 'text') {
        this.sink.node({
          id,
          kind: 'assistant_message',
          parentId,
          createdAt,
          text: String(block.text ?? ''),
          status: 'completed',
        });
      } else if (block.type === 'thinking') {
        this.sink.node({
          id,
          kind: 'reasoning',
          parentId,
          createdAt,
          text: String(block.thinking ?? ''),
          status: 'completed',
        });
      } else if (block.type === 'tool_use') {
        this.toolUse(block, parentId);
      }
    }
  }

  private toolUse(block: ContentBlock, parentId: string | null): void {
    const name = String(block.name);
    const input = (block.input ?? {}) as Json;
    if (name === 'TodoWrite') {
      this.plan = todoEntries(input);
      this.emitPlan(parentId);
      return;
    }
    const node: ToolCallNode = {
      id: `claude-tool-${String(block.id)}`,
      kind: 'tool_call',
      parentId,
      createdAt: Date.now(),
      tool: toolKind(name),
      name,
      title: toolTitle(name, input),
      input,
      command: name === 'Bash' ? str(input.command) : undefined,
      output: '',
      files: toolFiles(name, input),
      status: 'running',
    };
    this.tools.set(String(block.id), node);
    this.sink.node(node);
    if (name === 'TaskUpdate' && str(input.taskId)) {
      const entry = this.tasks.get(String(input.taskId));
      if (entry && (input.status === 'completed' || input.status === 'in_progress' || input.status === 'pending')) {
        entry.status = input.status;
        this.emitTasks(parentId);
      }
    }
  }

  user(message: Json, structured: unknown, parentToolUseId: string | null, uuid: string | undefined): void {
    const content = message.content;
    if (!Array.isArray(content)) {
      if (uuid && typeof content === 'string') this.userMessage(uuid, content, parentToolUseId);
      return;
    }
    const results = (content as ContentBlock[]).filter((part) => part.type === 'tool_result');
    if (results.length === 0) {
      if (uuid) this.userMessage(uuid, userText(content), parentToolUseId);
      return;
    }
    for (const result of results) {
      const node = this.tools.get(String(result.tool_use_id));
      if (!node) continue;
      const updated: ToolCallNode = {
        ...node,
        output: resultText(result.content),
        status: result.is_error ? 'failed' : 'completed',
        files: this.filesFrom(node, structured),
      };
      this.tools.set(String(result.tool_use_id), updated);
      this.sink.node(updated);
      if (node.name === 'TaskCreate') this.taskCreated(node, structured);
    }
  }

  private userMessage(uuid: string, text: string, parentToolUseId: string | null): void {
    if (parentToolUseId || !text || text.startsWith('<')) return;
    this.sink.node({
      id: `${USER_PREFIX}${uuid}`,
      kind: 'user_message',
      parentId: null,
      createdAt: Date.now(),
      text,
      attachments: [],
      delivery: 'prompt',
    });
  }

  private filesFrom(node: ToolCallNode, structured: unknown): FileChange[] {
    if (node.tool !== 'edit' || !structured || typeof structured !== 'object') return node.files;
    const output = structured as Json;
    const path = str(output.filePath) ?? node.files[0]?.path;
    const hunks = Array.isArray(output.structuredPatch) ? (output.structuredPatch as StructuredPatchHunk[]) : [];
    if (!path) return node.files;
    const gitDiff = output.gitDiff as Json | undefined;
    const diff = str(gitDiff?.patch) ?? (hunks.length ? unifiedDiff(path, hunks) : undefined);
    const change = output.type === 'create' ? 'add' : (node.files[0]?.change ?? 'modify');
    return [{ path, change, diff }];
  }

  private taskCreated(node: ToolCallNode, structured: unknown): void {
    const output = (structured ?? {}) as Json;
    const task = (output.task ?? output) as Json;
    const id = str(task.id) ?? (typeof task.id === 'number' ? String(task.id) : undefined);
    const input = node.input as Json;
    if (!id) return;
    this.tasks.set(id, { text: str(input.subject) ?? str(task.subject) ?? node.title, status: 'pending' });
    this.emitTasks(node.parentId);
  }

  private emitTasks(parentId: string | null): void {
    this.plan = [...this.tasks.values()].map((entry) => ({ ...entry }));
    this.emitPlan(parentId);
  }

  private emitPlan(parentId: string | null): void {
    this.sink.node({ id: 'claude-plan', kind: 'plan', parentId, createdAt: Date.now(), entries: this.plan });
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

class ClaudeSession implements DriverSession {
  readonly capabilities = CAPABILITIES;
  private q: Query | null = null;
  private input: InputQueue | null = null;
  private loop: Promise<void> | null = null;
  private sessionId: string | null;
  private effort: EffortLevel | undefined;
  private closing = false;
  private readonly transcript: ClaudeTranscript;
  private readonly messageIds = new Map<string | null, string>();
  /** For a rewind: the last assistant message uuid before each user message we sent. */
  private readonly before = new Map<string, string | null>();
  private lastAssistantUuid: string | null = null;
  /** Claude reports the model it resolved (`claude-opus-5-5`); the menu lists the aliases that resolve to them. */
  private readonly modelAliases = new Map<string, string>();
  private reportedModel: string | undefined;

  constructor(
    private readonly context: DriverContext,
    private readonly binary: string,
  ) {
    this.sessionId = context.resume?.agentSessionId ?? null;
    this.transcript = new ClaudeTranscript(context.sink);
  }

  private get sink(): DriverSink {
    return this.context.sink;
  }

  async open(): Promise<void> {
    if (this.context.resume) await this.importHistory(this.context.resume.agentSessionId);
    this.begin(this.context.resume?.fork ? { forkSession: true } : {});
    this.sink.session({ modes: MODES, efforts: EFFORTS });
  }

  private async importHistory(sessionId: string): Promise<void> {
    try {
      const messages = await getSessionMessages(sessionId, { dir: this.context.cwd });
      const nodes = new Map<string, ChatNode>();
      const collector = new ClaudeTranscript({
        node: (node) => nodes.set(node.id, node),
        append: () => undefined,
      });
      for (const message of messages) {
        const body = (message.message ?? {}) as Json;
        if (message.type === 'assistant') {
          collector.assistant(body, message.parent_tool_use_id);
          this.lastAssistantUuid = message.uuid;
        } else if (message.type === 'user') {
          const structured = (message as unknown as Json).tool_use_result;
          collector.user(body, structured, message.parent_tool_use_id, message.uuid);
          if (!message.parent_tool_use_id) this.before.set(`${USER_PREFIX}${message.uuid}`, this.lastAssistantUuid);
        }
      }
      this.sink.history([...nodes.values()]);
    } catch (error) {
      this.sink.log('claude history import failed', { error: String(error) });
    }
  }

  private options(extra: Partial<Options>): Options {
    const instructions = this.context.instructions;
    const canUseTool: CanUseTool = (toolName, input, options) => this.permission(toolName, input, options);
    return {
      cwd: this.context.cwd,
      pathToClaudeCodeExecutable: this.binary,
      spawnClaudeCodeProcess: (spawn) => deferredProcess(this.context.spawn({ ...spawn, env: addedEnv(spawn.env) })),
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', ...(instructions && { append: instructions }) },
      includePartialMessages: true,
      enableFileCheckpointing: true,
      canUseTool,
      ...(this.effort && { effort: this.effort }),
      ...(this.sessionId && { resume: this.sessionId }),
      ...extra,
    };
  }

  private begin(extra: Partial<Options>): void {
    this.input = new InputQueue();
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
        models: models.map((model) => ({ id: model.value, label: model.displayName, description: model.description })),
        ...this.modelPatch(models),
      });
    } catch (error) {
      this.sink.log('claude metadata load failed', { error: String(error) });
    }
  }

  private modelPatch(
    models: { value: string; resolvedModel?: string }[] | null,
    reported?: string,
  ): { model?: string } {
    for (const model of models ?? []) {
      if (model.resolvedModel && !this.modelAliases.has(model.resolvedModel)) {
        this.modelAliases.set(model.resolvedModel, model.value);
      }
    }
    if (reported) this.reportedModel = reported;
    if (!this.reportedModel) return {};
    return { model: this.modelAliases.get(this.reportedModel) ?? this.reportedModel };
  }

  private async consume(q: Query): Promise<void> {
    try {
      for await (const message of q) this.handle(message);
      if (!this.closing && this.q === q)
        this.sink.session({ status: 'exited', statusDetail: 'Claude ended the session' });
    } catch (error) {
      if (!this.closing && this.q === q) {
        this.sink.session({ status: 'error', statusDetail: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private handle(message: SDKMessage): void {
    switch (message.type) {
      case 'system':
        this.system(message as unknown as Json);
        return;
      case 'stream_event':
        this.transcript.streamEvent(message.event as unknown as Json, message.parent_tool_use_id, this.messageIds);
        return;
      case 'assistant':
        this.transcript.assistant(message.message as unknown as Json, message.parent_tool_use_id);
        if (!message.parent_tool_use_id) this.lastAssistantUuid = message.uuid;
        if (message.error) this.notice('error', `Claude: ${message.error}`);
        return;
      case 'user':
        this.transcript.user(
          message.message as unknown as Json,
          message.tool_use_result,
          message.parent_tool_use_id,
          message.isSynthetic ? undefined : (message as { uuid?: string }).uuid,
        );
        return;
      case 'result': {
        const result = message as unknown as Json;
        const usage = (result.usage ?? {}) as Json;
        this.sink.session({
          status: 'idle',
          usage: {
            inputTokens: Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0),
            outputTokens: Number(usage.output_tokens ?? 0),
            costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : undefined,
          },
        });
        if (result.subtype !== 'success') {
          const errors = Array.isArray(result.errors) ? result.errors.join('\n') : '';
          if (result.subtype !== 'error_during_execution' || errors) {
            this.notice('error', errors || `The turn ended: ${String(result.subtype)}`);
          }
        }
        return;
      }
      case 'rate_limit_event': {
        const info = (message as unknown as Json).rate_limit_info as Json | undefined;
        if (info?.status === 'rejected') this.notice('warning', 'Usage limit reached');
        return;
      }
    }
  }

  private system(message: Json): void {
    switch (message.subtype) {
      case 'init':
        this.sessionId = String(message.session_id);
        this.sink.session({
          agentSessionId: this.sessionId,
          ...this.modelPatch(null, str(message.model)),
          mode: str(message.permissionMode),
          agentVersion: str(message.claude_code_version),
        });
        return;
      case 'status':
        if (str(message.permissionMode)) this.sink.session({ mode: str(message.permissionMode) });
        return;
      case 'session_state_changed':
        if (message.state === 'idle') this.sink.session({ status: 'idle' });
        else if (message.state === 'running') this.sink.session({ status: 'running' });
        return;
      case 'compact_boundary': {
        const metadata = (message.compact_metadata ?? {}) as Json;
        this.sink.node({
          id: `claude-compact-${String(message.uuid)}`,
          kind: 'compaction',
          parentId: null,
          createdAt: Date.now(),
          trigger: metadata.trigger === 'manual' ? 'manual' : 'auto',
        });
        return;
      }
      case 'commands_changed': {
        const commands = Array.isArray(message.commands) ? (message.commands as Json[]) : [];
        this.sink.session({
          commands: commands.map((command) => ({
            name: String(command.name),
            description: str(command.description),
            argumentHint: str(command.argumentHint) || undefined,
          })),
        });
        return;
      }
      case 'task_started':
        if (str(message.tool_use_id)) {
          this.sink.node({
            id: `claude-task-${String(message.task_id)}`,
            kind: 'subagent',
            parentId: `claude-tool-${String(message.tool_use_id)}`,
            createdAt: Date.now(),
            title: String(message.description ?? 'Subagent'),
            agentType: str(message.subagent_type),
            status: 'running',
          });
        }
        return;
      case 'notification':
      case 'informational':
        if (str(message.text) ?? str(message.message)) this.notice('info', String(message.text ?? message.message));
        return;
    }
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.sink.node({
      id: `claude-notice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'notice',
      parentId: null,
      createdAt: Date.now(),
      level,
      text,
    });
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
    return permissionResult(answer, input, options.suggestions);
  }

  private async userMessage(input: UserInput, priority?: 'next' | 'later'): Promise<void> {
    if (!this.input) throw new Error('Claude is not running');
    const uuid = uuidOf(input.id);
    this.before.set(input.id, this.lastAssistantUuid);
    this.input.push({
      type: 'user',
      message: { role: 'user', content: (await messageContent(input)) as never },
      parent_tool_use_id: null,
      uuid: uuid as SDKUserMessage['uuid'],
      session_id: this.sessionId ?? '',
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
    await this.q?.interrupt();
  }

  async setModel(model: string): Promise<void> {
    await this.q?.setModel(model);
  }

  async setMode(mode: string): Promise<void> {
    await this.q?.setPermissionMode(mode as PermissionMode);
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
    const keep = this.before.get(userMessageId) ?? null;
    if (keep) {
      await this.restart({ resumeSessionAt: keep });
    } else {
      this.sessionId = null;
      await this.restart({});
    }
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

export const claudeDriver: AgentDriver = {
  id: 'claude',
  label: 'Claude Code',

  async probe() {
    const binary = resolveAgentBinary('claude');
    if (!binary)
      return { installed: false, problem: 'Claude Code is not installed. Install it from claude.com/claude-code.' };
    const version = await binaryVersion(binary);
    if (version && compareVersions(version, CLAUDE_MIN_VERSION) < 0) {
      return {
        installed: true,
        version,
        problem: `Chat needs Claude Code ${CLAUDE_MIN_VERSION} or newer; ${version} is installed.`,
      };
    }
    return { installed: true, version };
  },

  async start(context) {
    const binary = resolveAgentBinary('claude');
    if (!binary) throw new Error('Claude Code is not installed');
    const session = new ClaudeSession(context, binary);
    await session.open();
    return session;
  },

  terminalResume(agentSessionId) {
    return { file: 'claude', args: agentSessionId ? ['--resume', agentSessionId] : [] };
  },
};
