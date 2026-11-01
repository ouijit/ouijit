import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { binaryVersion, compareVersions, resolveAgentBinary } from '../binaries';
import { exited, onLines, stderrTail, terminate, type AgentProcess } from '../process';
import { getPiApprovalExtensionPath } from '../piApprovals';
import type { AgentDriver, DriverContext, DriverSession, DriverSink, UserInput } from '../driver';
import type { ChatAnswer, ChatCapabilities, ChatNode, ChatOption, FileChange, ToolCallNode, ToolKind } from '../model';

/** The oldest release the chat driver has been recorded against; RPC mode changed shape before it. */
const PI_MIN_VERSION = '0.84.0';

const CAPABILITIES: ChatCapabilities = {
  images: true,
  steer: true,
  queue: true,
  interrupt: true,
  models: true,
  effort: true,
  modes: false,
  commands: true,
  fork: true,
  rewind: true,
  compact: true,
};

type Json = Record<string, unknown>;

function toolKind(name: string): ToolKind {
  switch (name) {
    case 'bash':
      return 'command';
    case 'read':
      return 'read';
    case 'edit':
    case 'write':
      return 'edit';
    case 'grep':
    case 'find':
    case 'ls':
      return 'search';
    default:
      return 'other';
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toolTitle(name: string, args: Json): string {
  const path = str(args.path) ?? str(args.file_path);
  switch (name) {
    case 'bash':
      return str(args.command) ?? 'Run a command';
    case 'read':
      return `Read ${path ?? 'a file'}`;
    case 'edit':
      return `Edit ${path ?? 'a file'}`;
    case 'write':
      return `Write ${path ?? 'a file'}`;
    case 'grep':
      return `Search for ${str(args.pattern) ?? 'text'}`;
    case 'find':
      return `Find ${str(args.pattern) ?? 'files'}`;
    case 'ls':
      return `List ${path ?? '.'}`;
    default:
      return name;
  }
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: Json) => part.type === 'text')
    .map((part: Json) => String(part.text ?? ''))
    .join('\n');
}

function files(name: string, args: Json, details: unknown): FileChange[] {
  const path = str(args.path) ?? str(args.file_path);
  if (!path || toolKind(name) !== 'edit') return [];
  const diff = details && typeof details === 'object' ? str((details as Json).diff) : undefined;
  return [{ path, change: name === 'write' ? 'add' : 'modify', diff }];
}

/** Assistant nodes key on the message timestamp, which a live message and `get_messages` share. */
function blockId(timestamp: unknown, index: number): string {
  return `pi-${String(timestamp)}-${index}`;
}

function toolNode(toolCallId: string, name: string, args: Json): ToolCallNode {
  return {
    id: `pi-tool-${toolCallId}`,
    kind: 'tool_call',
    parentId: null,
    createdAt: Date.now(),
    tool: toolKind(name),
    name,
    title: toolTitle(name, args),
    input: args,
    command: name === 'bash' ? str(args.command) : undefined,
    output: '',
    files: files(name, args, undefined),
    status: 'running',
  };
}

function piHistoryNodes(messages: Json[]): ChatNode[] {
  const nodes: ChatNode[] = [];
  const tools = new Map<string, ToolCallNode>();
  for (const message of messages) {
    const createdAt = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
    if (message.role === 'user') {
      const text = contentText(message.content);
      if (text) {
        nodes.push({
          id: `pi-user-${String(message.timestamp)}`,
          kind: 'user_message',
          parentId: null,
          createdAt,
          text,
          attachments: [],
          delivery: 'prompt',
        });
      }
    } else if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? (message.content as Json[]) : [];
      content.forEach((part, index) => {
        if (part.type === 'text') {
          nodes.push({
            id: blockId(message.timestamp, index),
            kind: 'assistant_message',
            parentId: null,
            createdAt,
            text: String(part.text ?? ''),
            status: 'completed',
          });
        } else if (part.type === 'thinking') {
          nodes.push({
            id: blockId(message.timestamp, index),
            kind: 'reasoning',
            parentId: null,
            createdAt,
            text: String(part.thinking ?? ''),
            status: 'completed',
          });
        } else if (part.type === 'toolCall') {
          const node = {
            ...toolNode(String(part.id), String(part.name), (part.arguments ?? {}) as Json),
            createdAt,
            status: 'completed' as const,
          };
          tools.set(String(part.id), node);
          nodes.push(node);
        }
      });
    } else if (message.role === 'toolResult') {
      const node = tools.get(String(message.toolCallId));
      if (node) {
        const index = nodes.indexOf(node);
        nodes[index] = {
          ...node,
          output: contentText(message.content),
          status: message.isError ? 'failed' : 'completed',
          files: files(node.name, node.input as Json, message.details),
        };
      }
    }
  }
  return nodes;
}

class PiSession implements DriverSession {
  readonly capabilities = CAPABILITIES;
  private nextId = 1;
  private readonly waiting = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  private currentAssistant: unknown = null;
  private readonly tools = new Map<string, ToolCallNode>();
  private readonly userOrder: string[] = [];
  closing = false;

  constructor(
    private readonly proc: AgentProcess,
    private readonly sink: DriverSink,
  ) {
    onLines(proc.stdout, (line) => this.receive(line));
    proc.once('exit', () => {
      for (const { reject } of this.waiting.values()) reject(new Error('pi exited'));
      this.waiting.clear();
    });
  }

  private command<T = unknown>(command: Json): Promise<T> {
    const id = `ouijit-${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (data: unknown) => void, reject });
      this.proc.stdin.write(JSON.stringify({ ...command, id }) + '\n');
    });
  }

  async open(resumed: boolean): Promise<void> {
    const state = await this.command<Json>({ type: 'get_state' });
    const model = state.model as Json | null;
    this.sink.session({
      agentSessionId: str(state.sessionId) ?? null,
      ...(model && { model: `${String(model.provider)}/${String(model.id)}` }),
      effort: str(state.thinkingLevel),
    });
    if (resumed) {
      const { messages } = await this.command<{ messages: Json[] }>({ type: 'get_messages' });
      this.sink.history(piHistoryNodes(messages));
    }
    void this.loadMetadata();
  }

  private async loadMetadata(): Promise<void> {
    try {
      const [{ models }, { levels }, { commands }] = await Promise.all([
        this.command<{ models: Json[] }>({ type: 'get_available_models' }),
        this.command<{ levels: string[] }>({ type: 'get_available_thinking_levels' }),
        this.command<{ commands: Json[] }>({ type: 'get_commands' }),
      ]);
      const options: ChatOption[] = models.map((model) => ({
        id: `${String(model.provider)}/${String(model.id)}`,
        label: String(model.name ?? model.id),
        description: String(model.provider),
      }));
      this.sink.session({
        models: options,
        efforts: levels.map((level) => ({ id: level, label: level })),
        commands: commands.map((command) => ({ name: String(command.name), description: str(command.description) })),
      });
    } catch (error) {
      this.sink.log('pi metadata load failed', { error: String(error) });
    }
  }

  private receive(line: string): void {
    let event: Json;
    try {
      event = JSON.parse(line) as Json;
    } catch {
      return;
    }
    if (event.type === 'response') {
      const waiter = this.waiting.get(String(event.id));
      if (!waiter) return;
      this.waiting.delete(String(event.id));
      if (event.success) waiter.resolve(event.data ?? {});
      else waiter.reject(new Error(String(event.error ?? `pi rejected ${String(event.command)}`)));
      return;
    }
    this.event(event);
  }

  private event(event: Json): void {
    switch (event.type) {
      case 'agent_start':
        this.sink.session({ status: 'running' });
        return;
      case 'agent_settled':
        this.sink.session({ status: 'idle' });
        return;
      case 'message_start': {
        const message = event.message as Json;
        if (message.role === 'assistant') this.currentAssistant = message.timestamp;
        return;
      }
      case 'message_update':
        this.update(event);
        return;
      case 'message_end': {
        const message = event.message as Json;
        if (message.role !== 'assistant') return;
        const content = Array.isArray(message.content) ? (message.content as Json[]) : [];
        content.forEach((part, index) => {
          const id = blockId(message.timestamp, index);
          if (part.type === 'text') {
            this.sink.node({
              id,
              kind: 'assistant_message',
              parentId: null,
              createdAt: Date.now(),
              text: String(part.text ?? ''),
              status: 'completed',
            });
          } else if (part.type === 'thinking') {
            this.sink.node({
              id,
              kind: 'reasoning',
              parentId: null,
              createdAt: Date.now(),
              text: String(part.thinking ?? ''),
              status: 'completed',
            });
          }
        });
        if (message.stopReason === 'error' && str(message.errorMessage))
          this.notice('error', String(message.errorMessage));
        return;
      }
      case 'tool_execution_start': {
        const node = toolNode(String(event.toolCallId), String(event.toolName), (event.args ?? {}) as Json);
        this.tools.set(String(event.toolCallId), node);
        this.sink.node(node);
        return;
      }
      case 'tool_execution_update': {
        const node = this.tools.get(String(event.toolCallId));
        const partial = event.partialResult as Json | undefined;
        if (!node || !partial) return;
        const updated = { ...node, output: contentText(partial.content) };
        this.tools.set(String(event.toolCallId), updated);
        this.sink.node(updated);
        return;
      }
      case 'tool_execution_end': {
        const node = this.tools.get(String(event.toolCallId));
        const result = (event.result ?? {}) as Json;
        if (!node) return;
        this.tools.delete(String(event.toolCallId));
        this.sink.node({
          ...node,
          output: contentText(result.content),
          status: event.isError ? 'failed' : 'completed',
          files: files(node.name, node.input as Json, result.details),
        });
        return;
      }
      case 'compaction_end':
        this.sink.node({
          id: `pi-compact-${Date.now()}`,
          kind: 'compaction',
          parentId: null,
          createdAt: Date.now(),
          trigger: event.reason === 'manual' ? 'manual' : 'auto',
        });
        return;
      case 'auto_retry_start':
        this.notice('warning', `Retrying: ${String(event.errorMessage ?? 'transient error')}`);
        return;
      case 'extension_error':
        this.notice('error', `Extension error: ${String(event.error ?? '')}`);
        return;
      case 'extension_ui_request':
        void this.dialog(event);
        return;
    }
  }

  private update(event: Json): void {
    const delta = event.assistantMessageEvent as Json | undefined;
    if (!delta || this.currentAssistant == null) return;
    const id = blockId(this.currentAssistant, Number(delta.contentIndex ?? 0));
    switch (delta.type) {
      case 'text_start':
        this.sink.node({
          id,
          kind: 'assistant_message',
          parentId: null,
          createdAt: Date.now(),
          text: '',
          status: 'running',
        });
        return;
      case 'thinking_start':
        this.sink.node({ id, kind: 'reasoning', parentId: null, createdAt: Date.now(), text: '', status: 'running' });
        return;
      case 'text_delta':
      case 'thinking_delta':
        this.sink.append(id, 'text', String(delta.delta ?? ''));
        return;
    }
    const usage = event.usage as Json | undefined;
    if (usage) {
      this.sink.session({
        usage: {
          inputTokens: Number(usage.input ?? 0) + Number(usage.cacheRead ?? 0),
          outputTokens: Number(usage.output ?? 0),
        },
      });
    }
  }

  /** Extension dialogs — our approval gate's among them — answered from any client. */
  private async dialog(request: Json): Promise<void> {
    const method = String(request.method);
    const id = String(request.id);
    if (method === 'notify') {
      this.notice(
        request.notifyType === 'error' ? 'error' : request.notifyType === 'warning' ? 'warning' : 'info',
        String(request.message ?? ''),
      );
      return;
    }
    if (!['select', 'confirm', 'input', 'editor'].includes(method)) return;
    const gate = parseGate(request);
    let answer: ChatAnswer;
    if (method === 'select') {
      const options = Array.isArray(request.options) ? request.options.map(String) : [];
      answer = await this.sink.ask({
        id: `pi-dialog-${id}`,
        parentId: null,
        request: 'approval',
        title: gate?.title ?? String(request.title ?? 'pi is asking'),
        detail: gate?.detail,
        toolCallId: gate ? `pi-tool-${gate.toolCallId}` : undefined,
        options: options.map((label, index) => ({
          id: label,
          label,
          kind: gate
            ? index === 0
              ? 'allow_once'
              : index === options.length - 1
                ? 'reject_once'
                : 'allow_always'
            : 'other',
        })),
        questions: [],
      });
      this.respond(answer.kind === 'option' ? { id, value: answer.optionId } : { id, cancelled: true });
    } else if (method === 'confirm') {
      answer = await this.sink.ask({
        id: `pi-dialog-${id}`,
        parentId: null,
        request: 'approval',
        title: String(request.title ?? 'Confirm'),
        detail: str(request.message),
        options: [
          { id: 'yes', label: 'Yes', kind: 'allow_once' },
          { id: 'no', label: 'No', kind: 'reject_once' },
        ],
        questions: [],
      });
      this.respond(answer.kind === 'option' ? { id, confirmed: answer.optionId === 'yes' } : { id, cancelled: true });
    } else {
      answer = await this.sink.ask({
        id: `pi-dialog-${id}`,
        parentId: null,
        request: 'questions',
        title: String(request.title ?? 'pi needs input'),
        options: [],
        questions: [
          { id: 'value', question: String(request.title ?? ''), options: [], multiSelect: false, allowText: true },
        ],
      });
      const value = answer.kind === 'answers' ? answer.answers.value?.[0] : undefined;
      this.respond(value !== undefined ? { id, value } : { id, cancelled: true });
    }
  }

  private respond(response: Json): void {
    this.proc.stdin.write(JSON.stringify({ type: 'extension_ui_response', ...response }) + '\n');
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.sink.node({
      id: `pi-notice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'notice',
      parentId: null,
      createdAt: Date.now(),
      level,
      text,
    });
  }

  private async images(input: UserInput): Promise<Json[]> {
    const images: Json[] = [];
    for (const attachment of input.attachments) {
      if (!attachment.mimeType.startsWith('image/')) continue;
      const data = await readFile(attachment.path);
      images.push({ type: 'image', data: data.toString('base64'), mimeType: attachment.mimeType });
    }
    return images;
  }

  private message(input: UserInput): string {
    const mentions = input.attachments.filter((a) => !a.mimeType.startsWith('image/')).map((a) => `@${a.path}`);
    return [input.text, ...mentions].filter(Boolean).join('\n');
  }

  async prompt(input: UserInput): Promise<void> {
    this.userOrder.push(input.id);
    const images = await this.images(input);
    await this.command({ type: 'prompt', message: this.message(input), ...(images.length && { images }) });
  }

  async send(input: UserInput, delivery: 'steer' | 'queue'): Promise<void> {
    this.userOrder.push(input.id);
    const images = await this.images(input);
    await this.command({
      type: 'prompt',
      message: this.message(input),
      streamingBehavior: delivery === 'steer' ? 'steer' : 'followUp',
      ...(images.length && { images }),
    });
  }

  async interrupt(): Promise<void> {
    await this.command({ type: 'abort' });
  }

  async setModel(model: string): Promise<void> {
    const slash = model.indexOf('/');
    await this.command({ type: 'set_model', provider: model.slice(0, slash), modelId: model.slice(slash + 1) });
    const { levels } = await this.command<{ levels: string[] }>({ type: 'get_available_thinking_levels' });
    this.sink.session({ efforts: levels.map((level) => ({ id: level, label: level })) });
  }

  async setEffort(effort: string): Promise<void> {
    await this.command({ type: 'set_thinking_level', level: effort });
  }

  /** pi forks from a user message into a new branch of the session, which is the rewind. Edits stay. */
  async rewind(userMessageId: string): Promise<void> {
    const { messages } = await this.command<{ messages: { entryId: string }[] }>({ type: 'get_fork_messages' });
    const index = this.userOrder.indexOf(userMessageId);
    const target = index === -1 ? undefined : messages[messages.length - (this.userOrder.length - index)];
    if (!target) throw new Error('pi has no record of that message');
    await this.command({ type: 'fork', entryId: target.entryId });
    this.userOrder.splice(index);
    const state = await this.command<Json>({ type: 'get_state' });
    this.sink.session({ agentSessionId: str(state.sessionId) ?? null });
  }

  async clear(): Promise<void> {
    await this.command({ type: 'new_session' });
    this.userOrder.splice(0);
    const state = await this.command<Json>({ type: 'get_state' });
    this.sink.reset();
    this.sink.session({ agentSessionId: str(state.sessionId) ?? null });
  }

  async compact(): Promise<void> {
    await this.command({ type: 'compact' });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.proc.stdin.end();
    await terminate(this.proc);
  }
}

/** The approval gate extension marks its dialogs so they render as tool approvals. */
function parseGate(request: Json): { toolCallId: string; title: string; detail?: string } | null {
  const title = str(request.title);
  if (!title?.startsWith('ouijit-gate:')) return null;
  try {
    const gate = JSON.parse(title.slice('ouijit-gate:'.length)) as Json;
    return { toolCallId: String(gate.toolCallId), title: String(gate.title), detail: str(gate.detail) };
  } catch {
    return null;
  }
}

export const piDriver: AgentDriver = {
  id: 'pi',
  label: 'Pi',

  async probe() {
    const binary = resolveAgentBinary('pi');
    if (!binary) return { installed: false, problem: 'Pi is not installed. Install it from pi.dev.' };
    const version = await binaryVersion(binary);
    if (version && compareVersions(version, PI_MIN_VERSION) < 0) {
      return {
        installed: true,
        version,
        problem: `Chat needs Pi ${PI_MIN_VERSION} or newer; ${version} is installed.`,
      };
    }
    return { installed: true, version };
  },

  async start(context: DriverContext) {
    const binary = resolveAgentBinary('pi');
    if (!binary) throw new Error('Pi is not installed');
    const args = ['--mode', 'rpc'];
    if (context.resume?.fork) args.push('--fork', context.resume.agentSessionId);
    else args.push('--session-id', context.resume?.agentSessionId ?? randomUUID());
    const instructions = context.instructions;
    if (instructions) args.push('--append-system-prompt', instructions);
    if (context.preferences.piApprovals) args.push('--extension', getPiApprovalExtensionPath());
    const proc = await context.spawn({ command: binary, args });
    const tail = stderrTail(proc);
    const session = new PiSession(proc, context.sink);
    void exited(proc).then((code) => {
      if (session.closing) return;
      context.sink.session({
        status: code === 0 ? 'exited' : 'error',
        statusDetail: tail() || `Pi exited (code ${code ?? 'signal'})`,
      });
    });
    try {
      await session.open(context.resume != null);
    } catch (error) {
      await session.close();
      throw new Error(tail() || (error instanceof Error ? error.message : String(error)));
    }
    return session;
  },

  terminalResume(agentSessionId) {
    return { file: 'pi', args: agentSessionId ? ['--session', agentSessionId] : [] };
  },
};
