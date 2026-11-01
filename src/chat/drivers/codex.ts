import { JsonRpcPeer, RpcError } from '../jsonRpc';
import { binaryVersion, compareVersions, ouijitInstructions, resolveAgentBinary } from '../binaries';
import { exited, stderrTail, terminate } from '../process';
import type { AgentDriver, DriverContext, DriverSession, DriverSink, UserInput } from '../driver';
import type {
  ChatAnswer,
  ChatCapabilities,
  ChatNode,
  ChatOption,
  FileChange,
  NodeStatus,
  PlanEntry,
  RequestOption,
  ToolCallNode,
} from '../model';

/** The oldest release the chat driver has been recorded against; app-server's v2 surface moves between releases. */
const CODEX_MIN_VERSION = '0.149.0';

const CAPABILITIES: ChatCapabilities = {
  images: true,
  steer: true,
  queue: false,
  interrupt: true,
  models: true,
  effort: true,
  modes: false,
  commands: false,
  fork: true,
  rewind: false,
  compact: true,
};

type Json = Record<string, unknown>;

interface CodexItem extends Json {
  type: string;
  id: string;
}

function nodeId(itemId: string): string {
  return `codex-${itemId}`;
}

function itemStatus(status: unknown): NodeStatus {
  switch (status) {
    case 'inProgress':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'declined':
      return 'declined';
    default:
      return 'completed';
  }
}

function patchKind(kind: Json | undefined): Pick<FileChange, 'change' | 'movedFrom'> {
  switch (kind?.type) {
    case 'add':
      return { change: 'add' };
    case 'delete':
      return { change: 'delete' };
    default:
      return kind?.move_path ? { change: 'move' } : { change: 'modify' };
  }
}

function fileChanges(changes: unknown): FileChange[] {
  if (!Array.isArray(changes)) return [];
  return changes.map((change: Json) => {
    const kind = change.kind as Json | undefined;
    const moved = typeof kind?.move_path === 'string' ? kind.move_path : undefined;
    return {
      path: moved ?? String(change.path),
      ...patchKind(kind),
      ...(moved && { movedFrom: String(change.path) }),
      diff: typeof change.diff === 'string' ? change.diff : undefined,
    };
  });
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: Json) => part.type === 'text')
    .map((part: Json) => String(part.text ?? ''))
    .join('\n');
}

function tool(
  item: CodexItem,
  base: Omit<ToolCallNode, 'kind' | 'parentId' | 'createdAt' | 'id'>,
  parentId: string | null,
): ToolCallNode {
  return { id: nodeId(item.id), kind: 'tool_call', parentId, createdAt: Date.now(), ...base };
}

/** One app-server item as a transcript node. The same shape arrives live and from `thread/read`, so both use this. */
function codexItemNode(item: CodexItem, parentId: string | null = null): ChatNode | null {
  const id = nodeId(item.id);
  const createdAt = Date.now();
  switch (item.type) {
    case 'userMessage':
      return {
        id: typeof item.clientId === 'string' ? item.clientId : id,
        kind: 'user_message',
        parentId,
        createdAt,
        text: textOf(item.content),
        attachments: [],
        delivery: 'prompt',
      };
    case 'agentMessage':
      return { id, kind: 'assistant_message', parentId, createdAt, text: String(item.text ?? ''), status: 'completed' };
    case 'reasoning': {
      const summary = Array.isArray(item.summary) ? item.summary.join('\n\n') : '';
      const content = Array.isArray(item.content) ? item.content.join('\n\n') : '';
      return { id, kind: 'reasoning', parentId, createdAt, text: summary || content, status: 'completed' };
    }
    case 'plan':
      return { id, kind: 'plan', parentId, createdAt, entries: [], proposal: String(item.text ?? '') };
    case 'commandExecution':
      return tool(
        item,
        {
          tool: 'command',
          name: 'shell',
          title: String(item.command ?? ''),
          input: { command: item.command, cwd: item.cwd },
          command: String(item.command ?? ''),
          cwd: typeof item.cwd === 'string' ? item.cwd : undefined,
          output: String(item.aggregatedOutput ?? ''),
          exitCode: typeof item.exitCode === 'number' ? item.exitCode : undefined,
          files: [],
          status: itemStatus(item.status),
        },
        parentId,
      );
    case 'fileChange': {
      const files = fileChanges(item.changes);
      return tool(
        item,
        {
          tool: 'edit',
          name: 'apply_patch',
          title: files.length === 1 ? `Edit ${files[0].path}` : `Edit ${files.length} files`,
          input: item.changes,
          output: '',
          files,
          status: itemStatus(item.status),
        },
        parentId,
      );
    }
    case 'mcpToolCall':
      return tool(
        item,
        {
          tool: 'mcp',
          name: `${String(item.server)}.${String(item.tool)}`,
          title: `${String(item.server)}: ${String(item.tool)}`,
          input: item.arguments,
          output: item.result ? JSON.stringify(item.result) : item.error ? JSON.stringify(item.error) : '',
          files: [],
          status: itemStatus(item.status),
        },
        parentId,
      );
    case 'dynamicToolCall':
      return tool(
        item,
        {
          tool: 'other',
          name: String(item.tool ?? 'tool'),
          title: String(item.tool ?? 'Tool'),
          input: item.arguments,
          output: '',
          files: [],
          status: itemStatus(item.status),
        },
        parentId,
      );
    case 'collabAgentToolCall':
    case 'subAgentActivity':
      return tool(
        item,
        {
          tool: 'subagent',
          name: item.type,
          title: String(item.prompt ?? item.description ?? item.tool ?? 'Subagent'),
          input: item,
          output: '',
          files: [],
          status: itemStatus(item.status),
        },
        parentId,
      );
    case 'webSearch':
      return tool(
        item,
        {
          tool: 'fetch',
          name: 'web_search',
          title: `Search: ${String(item.query ?? '')}`,
          input: { query: item.query },
          output: '',
          files: [],
          status: 'completed',
        },
        parentId,
      );
    case 'imageView':
      return tool(
        item,
        {
          tool: 'read',
          name: 'view_image',
          title: `View ${String(item.path ?? 'image')}`,
          input: { path: item.path },
          output: '',
          files: [],
          status: 'completed',
        },
        parentId,
      );
    case 'contextCompaction':
      return { id, kind: 'compaction', parentId, createdAt, trigger: 'auto' };
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return {
        id,
        kind: 'notice',
        parentId,
        createdAt,
        level: 'info',
        text: item.type === 'enteredReviewMode' ? 'Review started' : 'Review finished',
      };
    default:
      return null;
  }
}

function planEntries(plan: unknown): PlanEntry[] {
  if (!Array.isArray(plan)) return [];
  return plan.map((step: Json) => ({
    text: String(step.step ?? ''),
    status: step.status === 'completed' ? 'completed' : step.status === 'inProgress' ? 'in_progress' : 'pending',
  }));
}

function codexInput(input: UserInput): Json[] {
  const parts: Json[] = [];
  if (input.text) parts.push({ type: 'text', text: input.text, text_elements: [] });
  for (const attachment of input.attachments) {
    if (attachment.mimeType.startsWith('image/')) parts.push({ type: 'localImage', path: attachment.path });
    else parts.push({ type: 'mention', name: attachment.name, path: attachment.path });
  }
  return parts;
}

const APPROVAL_OPTIONS: RequestOption[] = [
  { id: 'accept', label: 'Allow', kind: 'allow_once' },
  { id: 'acceptForSession', label: 'Allow for this session', kind: 'allow_always' },
  { id: 'decline', label: 'Decline', kind: 'reject_once' },
];

class CodexSession implements DriverSession {
  readonly capabilities = CAPABILITIES;
  private threadId = '';
  private turnId: string | null = null;
  private effort: string | null = null;
  private model: string | null = null;
  closing = false;

  constructor(
    private readonly rpc: JsonRpcPeer,
    private readonly sink: DriverSink,
    private readonly proc: Parameters<typeof terminate>[0],
  ) {}

  async open(cwd: string, resume: DriverContext['resume']): Promise<void> {
    await this.rpc.request('initialize', {
      clientInfo: { name: 'ouijit', title: 'Ouijit', version: '1' },
      capabilities: { experimentalApi: true },
    });
    this.rpc.notify('initialized');
    const developerInstructions = ouijitInstructions() || undefined;
    let response: Json;
    if (resume?.fork) {
      response = await this.rpc.request<Json>('thread/fork', {
        threadId: resume.agentSessionId,
        cwd,
        developerInstructions,
      });
    } else if (resume) {
      response = await this.rpc.request<Json>('thread/resume', {
        threadId: resume.agentSessionId,
        cwd,
        developerInstructions,
      });
    } else {
      response = await this.rpc.request<Json>('thread/start', { cwd, developerInstructions });
    }
    const thread = response.thread as Json;
    this.threadId = String(thread.id);
    this.model = typeof response.model === 'string' ? response.model : null;
    this.effort = typeof response.reasoningEffort === 'string' ? response.reasoningEffort : null;
    this.sink.session({
      agentSessionId: this.threadId,
      ...(this.model && { model: this.model }),
      ...(this.effort && { effort: this.effort }),
    });
    if (resume) await this.importHistory();
    void this.loadModels();
  }

  private async importHistory(): Promise<void> {
    const { thread } = await this.rpc.request<{ thread: Json }>('thread/read', {
      threadId: this.threadId,
      includeTurns: true,
    });
    const turns = Array.isArray(thread.turns) ? (thread.turns as Json[]) : [];
    const nodes = turns.flatMap((turn) =>
      (Array.isArray(turn.items) ? (turn.items as CodexItem[]) : []).flatMap((item): ChatNode[] => {
        const node = codexItemNode(item);
        return node ? [node] : [];
      }),
    );
    this.sink.history(nodes);
  }

  private async loadModels(): Promise<void> {
    try {
      const { data } = await this.rpc.request<{ data: Json[] }>('model/list', {});
      const visible = data.filter((model) => !model.hidden);
      const models: ChatOption[] = visible.map((model) => ({
        id: String(model.model ?? model.id),
        label: String(model.displayName ?? model.model),
        description: typeof model.description === 'string' ? model.description : undefined,
      }));
      const current = visible.find((model) => model.model === this.model) ?? visible.find((model) => model.isDefault);
      const efforts: ChatOption[] = Array.isArray(current?.supportedReasoningEfforts)
        ? (current.supportedReasoningEfforts as Json[]).map((option) => ({
            id: String(option.reasoningEffort ?? option.effort ?? option),
            label: String(option.reasoningEffort ?? option.effort ?? option),
            description: typeof option.description === 'string' ? option.description : undefined,
          }))
        : [];
      this.sink.session({ models, efforts });
    } catch (error) {
      this.sink.log('codex model/list failed', { error: String(error) });
    }
  }

  notification(method: string, params: Json): void {
    switch (method) {
      case 'turn/started':
        this.turnId = String((params.turn as Json).id);
        this.sink.session({ status: 'running' });
        return;
      case 'turn/completed': {
        const turn = params.turn as Json;
        this.turnId = null;
        if (turn.status === 'failed') {
          const error = turn.error as Json | null;
          this.notice('error', String(error?.message ?? 'The turn failed'));
        }
        this.sink.session({ status: 'idle' });
        return;
      }
      case 'item/started':
      case 'item/completed': {
        const item = params.item as CodexItem;
        // The host wrote the message it sent; the echo would only duplicate it.
        if (item.type === 'userMessage' && item.clientId) return;
        const node = codexItemNode(item);
        if (!node) return;
        if (method === 'item/started' && (node.kind === 'assistant_message' || node.kind === 'reasoning')) {
          this.sink.node({ ...node, status: 'running' });
        } else {
          this.sink.node(node);
        }
        return;
      }
      case 'item/agentMessage/delta':
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        this.sink.append(nodeId(String(params.itemId)), 'text', String(params.delta ?? ''));
        return;
      case 'item/commandExecution/outputDelta':
        this.sink.append(nodeId(String(params.itemId)), 'output', String(params.delta ?? ''));
        return;
      case 'turn/plan/updated':
        this.sink.node({
          id: `codex-plan-${String(params.turnId)}`,
          kind: 'plan',
          parentId: null,
          createdAt: Date.now(),
          entries: planEntries(params.plan),
        });
        return;
      case 'thread/tokenUsage/updated': {
        const usage = params.tokenUsage as Json;
        const total = usage.total as Json;
        this.sink.session({
          usage: {
            inputTokens: Number(total.inputTokens ?? 0),
            outputTokens: Number(total.outputTokens ?? 0),
            contextWindow: typeof usage.modelContextWindow === 'number' ? usage.modelContextWindow : undefined,
          },
        });
        return;
      }
      case 'error': {
        const error = params.error as Json;
        if (!params.willRetry) this.notice('error', String(error?.message ?? 'Codex reported an error'));
        return;
      }
      case 'warning':
      case 'configWarning':
      case 'deprecationNotice':
        this.notice('warning', String(params.message ?? params.summary ?? method));
        return;
      case 'thread/settings/updated':
        if (typeof params.model === 'string') this.sink.session({ model: params.model });
        return;
    }
  }

  async request(method: string, params: Json): Promise<unknown> {
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const answer = await this.sink.ask({
          id: `codex-approval-${String(params.itemId)}-${String(params.approvalId ?? '')}`,
          parentId: null,
          request: 'approval',
          title: `Run ${String(params.command ?? 'a command')}`,
          detail: typeof params.reason === 'string' ? params.reason : undefined,
          toolCallId: nodeId(String(params.itemId)),
          options: APPROVAL_OPTIONS,
          questions: [],
        });
        return { decision: decision(answer) };
      }
      case 'item/fileChange/requestApproval': {
        const answer = await this.sink.ask({
          id: `codex-approval-${String(params.itemId)}`,
          parentId: null,
          request: 'approval',
          title: 'Apply file changes',
          detail: typeof params.reason === 'string' ? params.reason : undefined,
          toolCallId: nodeId(String(params.itemId)),
          options: APPROVAL_OPTIONS,
          questions: [],
        });
        return { decision: decision(answer) };
      }
      case 'item/permissions/requestApproval': {
        const answer = await this.sink.ask({
          id: `codex-permissions-${String(params.itemId ?? Date.now())}`,
          parentId: null,
          request: 'approval',
          title: String(params.reason ?? 'Grant additional permissions'),
          options: APPROVAL_OPTIONS,
          questions: [],
        });
        return { decision: decision(answer) };
      }
      case 'item/tool/requestUserInput': {
        const questions = Array.isArray(params.questions) ? (params.questions as Json[]) : [];
        const answer = await this.sink.ask({
          id: `codex-input-${String(params.itemId)}`,
          parentId: null,
          request: 'questions',
          title: questions.length === 1 ? String(questions[0].question) : 'Codex has questions',
          options: [],
          questions: questions.map((question) => ({
            id: String(question.id),
            question: String(question.question),
            header: typeof question.header === 'string' ? question.header : undefined,
            options: Array.isArray(question.options)
              ? (question.options as Json[]).map((option) => ({
                  label: String(option.label ?? option),
                  description: typeof option.description === 'string' ? option.description : undefined,
                }))
              : [],
            multiSelect: false,
            allowText: question.isOther === true || !Array.isArray(question.options),
          })),
        });
        const answers = answer.kind === 'answers' ? answer.answers : {};
        return {
          answers: Object.fromEntries(Object.entries(answers).map(([key, values]) => [key, { answers: values }])),
        };
      }
      default:
        throw new RpcError(-32601, `Ouijit does not handle ${method}`);
    }
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.sink.node({
      id: `codex-notice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'notice',
      parentId: null,
      createdAt: Date.now(),
      level,
      text,
    });
  }

  async prompt(input: UserInput): Promise<void> {
    await this.rpc.request('turn/start', {
      threadId: this.threadId,
      clientUserMessageId: input.id,
      input: codexInput(input),
      ...(this.model && { model: this.model }),
      ...(this.effort && { effort: this.effort }),
    });
  }

  async send(input: UserInput): Promise<void> {
    if (!this.turnId) return this.prompt(input);
    await this.rpc.request('turn/steer', {
      threadId: this.threadId,
      clientUserMessageId: input.id,
      input: codexInput(input),
      expectedTurnId: this.turnId,
    });
  }

  async interrupt(): Promise<void> {
    if (!this.turnId) return;
    await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    void this.loadModels();
  }

  async setEffort(effort: string): Promise<void> {
    this.effort = effort;
  }

  async compact(): Promise<void> {
    await this.rpc.request('thread/compact/start', { threadId: this.threadId });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.rpc.dispose();
    await terminate(this.proc);
  }
}

function decision(answer: ChatAnswer): string {
  if (answer.kind !== 'option') return 'cancel';
  return answer.optionId;
}

export const codexDriver: AgentDriver = {
  id: 'codex',
  label: 'Codex',

  async probe() {
    const binary = resolveAgentBinary('codex');
    if (!binary)
      return { installed: false, problem: 'Codex is not installed. Install it from github.com/openai/codex.' };
    const version = await binaryVersion(binary);
    if (version && compareVersions(version, CODEX_MIN_VERSION) < 0) {
      return {
        installed: true,
        version,
        problem: `Chat needs Codex ${CODEX_MIN_VERSION} or newer; ${version} is installed.`,
      };
    }
    return { installed: true, version };
  },

  async start(context) {
    const binary = resolveAgentBinary('codex');
    if (!binary) throw new Error('Codex is not installed');
    const proc = await context.spawn({ command: binary, args: ['app-server'] });
    const tail = stderrTail(proc);
    let session: CodexSession | null = null;
    const rpc = new JsonRpcPeer(
      proc,
      {
        notification: (method, params) => session?.notification(method, (params ?? {}) as Json),
        request: async (method, params) => {
          if (!session) throw new RpcError(-32603, 'not ready');
          return session.request(method, (params ?? {}) as Json);
        },
      },
      { envelope: false, log: context.sink.log },
    );
    session = new CodexSession(rpc, context.sink, proc);
    void exited(proc).then((code) => {
      if (session?.closing) return;
      context.sink.session({
        status: code === 0 ? 'exited' : 'error',
        statusDetail: tail() || `Codex exited (code ${code ?? 'signal'})`,
      });
    });
    try {
      await session.open(context.cwd, context.resume);
    } catch (error) {
      await session.close();
      throw new Error(tail() || (error instanceof Error ? error.message : String(error)));
    }
    return session;
  },

  terminalResume(agentSessionId) {
    const binary = resolveAgentBinary('codex');
    if (!binary) return null;
    return { file: 'codex', args: agentSessionId ? ['resume', agentSessionId] : [] };
  },
};
