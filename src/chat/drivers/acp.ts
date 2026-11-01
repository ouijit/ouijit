import { readFile } from 'node:fs/promises';
import { JsonRpcPeer, RpcError } from '../jsonRpc';
import { exited, stderrTail, terminate, type AgentProcess } from '../process';
import { resolveAgentBinary } from '../binaries';
import type { AgentDriver, DriverContext, DriverSession, DriverSink, UserInput } from '../driver';
import type {
  ChatCapabilities,
  ChatNode,
  FileChange,
  NodeStatus,
  PlanEntry,
  RequestOptionKind,
  ToolCallNode,
  ToolKind,
} from '../model';

type Json = Record<string, unknown>;

const PROTOCOL_VERSION = 1;

function toolKind(kind: unknown): ToolKind {
  switch (kind) {
    case 'execute':
      return 'command';
    case 'edit':
    case 'delete':
    case 'move':
      return 'edit';
    case 'read':
      return 'read';
    case 'search':
      return 'search';
    case 'fetch':
      return 'fetch';
    default:
      return 'other';
  }
}

function toolStatus(status: unknown): NodeStatus {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'running';
    case 'failed':
      return 'failed';
    case 'completed':
      return 'completed';
    default:
      return 'running';
  }
}

/** ACP carries an edit as whole old and new text; this is the replacement written as a unified diff. */
function replacementDiff(path: string, oldText: string | null, newText: string): string {
  const before = oldText ? oldText.split('\n') : [];
  const after = newText.split('\n');
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const removed = before.slice(start, endBefore).map((line) => `-${line}`);
  const added = after.slice(start, endAfter).map((line) => `+${line}`);
  const header = `@@ -${start + 1},${endBefore - start} +${start + 1},${endAfter - start} @@`;
  return `--- a/${path}\n+++ b/${path}\n${header}\n${[...removed, ...added].join('\n')}`;
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item: Json) => {
      if (item.type === 'content') {
        const inner = item.content as Json;
        return inner?.type === 'text' ? String(inner.text ?? '') : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function contentFiles(content: unknown): FileChange[] {
  const files: FileChange[] = [];
  if (Array.isArray(content)) {
    for (const item of content as Json[]) {
      if (item.type !== 'diff') continue;
      const path = String(item.path);
      files.push({
        path,
        change: item.oldText == null ? 'add' : 'modify',
        diff: replacementDiff(path, (item.oldText as string | null) ?? null, String(item.newText ?? '')),
      });
    }
  }
  return files;
}

function planEntries(entries: unknown): PlanEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry: Json) => ({
    text: String(entry.content ?? ''),
    status: entry.status === 'completed' ? 'completed' : entry.status === 'in_progress' ? 'in_progress' : 'pending',
  }));
}

function optionKind(kind: unknown): RequestOptionKind {
  switch (kind) {
    case 'allow_once':
    case 'allow_always':
    case 'reject_once':
    case 'reject_always':
      return kind;
    default:
      return 'other';
  }
}

/** Split a command line on whitespace, honouring single and double quotes. */
function splitCommand(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;
  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) parts.push(current);
      current = '';
      started = false;
    } else {
      current += char;
    }
  }
  if (started || current) parts.push(current);
  return parts;
}

/**
 * An ACP v1 session. ACP streams message chunks without ids, so a run of
 * chunks of one kind is one node, and a tool call or a change of kind starts
 * the next.
 */
class AcpSession implements DriverSession {
  capabilities: ChatCapabilities = {
    images: false,
    steer: false,
    queue: false,
    interrupt: true,
    models: false,
    effort: false,
    modes: false,
    commands: false,
    fork: false,
    rewind: false,
    compact: false,
  };
  private sessionId = '';
  private stream: { kind: 'assistant_message' | 'reasoning' | 'user_message'; id: string } | null = null;
  private counter = 0;
  /** Streamed replies and thoughts of the running turn, completed when it ends. */
  private readonly streaming = new Map<
    string,
    { kind: 'assistant_message' | 'reasoning'; text: string; createdAt: number }
  >();
  private readonly tools = new Map<string, ToolCallNode>();
  private turn = 0;
  closing = false;
  private replaying = false;
  private readonly replayed: ChatNode[] = [];

  constructor(
    private readonly rpc: JsonRpcPeer,
    private readonly sink: DriverSink,
    private readonly proc: AgentProcess,
    private readonly prefix: string,
  ) {}

  async open(cwd: string, resume: DriverContext['resume']): Promise<void> {
    const init = await this.rpc.request<Json>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'ouijit', title: 'Ouijit', version: '1' },
    });
    const agent = (init.agentCapabilities ?? {}) as Json;
    const prompt = (agent.promptCapabilities ?? {}) as Json;
    this.capabilities = { ...this.capabilities, images: prompt.image === true };
    let response: Json;
    if (resume && !resume.fork && agent.loadSession === true) {
      this.sessionId = resume.agentSessionId;
      this.replaying = true;
      response = await this.rpc.request<Json>('session/load', { sessionId: this.sessionId, cwd, mcpServers: [] });
      this.replaying = false;
      this.sink.history(this.replayed.splice(0));
    } else {
      response = await this.rpc.request<Json>('session/new', { cwd, mcpServers: [] });
      this.sessionId = String(response.sessionId);
    }
    this.sink.session({ agentSessionId: this.sessionId });
    this.applyModes(response.modes as Json | undefined);
    this.applyModels(response.models as Json | undefined);
  }

  private applyModes(modes: Json | undefined): void {
    const available = Array.isArray(modes?.availableModes) ? (modes.availableModes as Json[]) : [];
    if (available.length === 0) return;
    this.capabilities = { ...this.capabilities, modes: true };
    this.sink.session({
      capabilities: this.capabilities,
      mode: typeof modes?.currentModeId === 'string' ? modes.currentModeId : undefined,
      modes: available.map((mode) => ({
        id: String(mode.id),
        label: String(mode.name ?? mode.id),
        description: typeof mode.description === 'string' ? mode.description : undefined,
      })),
    });
  }

  private applyModels(models: Json | undefined): void {
    const available = Array.isArray(models?.availableModels) ? (models.availableModels as Json[]) : [];
    if (available.length === 0) return;
    this.capabilities = { ...this.capabilities, models: true };
    this.sink.session({
      capabilities: this.capabilities,
      model: typeof models?.currentModelId === 'string' ? models.currentModelId : undefined,
      models: available.map((model) => ({
        id: String(model.modelId),
        label: String(model.name ?? model.modelId),
        description: typeof model.description === 'string' ? model.description : undefined,
      })),
    });
  }

  private emit(node: ChatNode): void {
    if (this.replaying) {
      const index = this.replayed.findIndex((existing) => existing.id === node.id);
      if (index === -1) this.replayed.push(node);
      else this.replayed[index] = node;
    } else {
      this.sink.node(node);
    }
  }

  private appendText(kind: 'assistant_message' | 'reasoning' | 'user_message', text: string): void {
    if (this.stream?.kind !== kind) {
      const id = `${this.prefix}-${this.turn}-${this.counter++}`;
      this.stream = { kind, id };
      const createdAt = Date.now();
      if (kind === 'user_message') {
        this.emit({ id, kind, parentId: null, createdAt, text, attachments: [], delivery: 'prompt' });
      } else {
        this.emit({ id, kind, parentId: null, createdAt, text, status: this.replaying ? 'completed' : 'running' });
        if (!this.replaying) this.streaming.set(id, { kind, text, createdAt });
      }
      return;
    }
    if (this.replaying) {
      const node = this.replayed.find((existing) => existing.id === this.stream!.id) as ChatNode & { text: string };
      if (node) node.text += text;
    } else {
      const open = this.streaming.get(this.stream.id);
      if (open) open.text += text;
      this.sink.append(this.stream.id, 'text', text);
    }
  }

  notification(method: string, params: Json): void {
    if (method !== 'session/update') return;
    const update = (params.update ?? {}) as Json;
    const chunk = (update.content ?? {}) as Json;
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (chunk.type === 'text') this.appendText('assistant_message', String(chunk.text ?? ''));
        return;
      case 'agent_thought_chunk':
        if (chunk.type === 'text') this.appendText('reasoning', String(chunk.text ?? ''));
        return;
      case 'user_message_chunk':
        if (this.replaying && chunk.type === 'text') this.appendText('user_message', String(chunk.text ?? ''));
        return;
      case 'tool_call':
      case 'tool_call_update':
        this.stream = null;
        this.toolCall(update);
        return;
      case 'plan':
        this.emit({
          id: `${this.prefix}-plan`,
          kind: 'plan',
          parentId: null,
          createdAt: Date.now(),
          entries: planEntries(update.entries),
        });
        return;
      case 'available_commands_update': {
        const commands = Array.isArray(update.availableCommands) ? (update.availableCommands as Json[]) : [];
        this.capabilities = { ...this.capabilities, commands: commands.length > 0 };
        this.sink.session({
          capabilities: this.capabilities,
          commands: commands.map((command) => ({
            name: String(command.name),
            description: typeof command.description === 'string' ? command.description : undefined,
            argumentHint:
              typeof (command.input as Json | undefined)?.hint === 'string'
                ? String((command.input as Json).hint)
                : undefined,
          })),
        });
        return;
      }
      case 'current_mode_update':
        this.sink.session({ mode: String(update.currentModeId) });
        return;
    }
  }

  private toolCall(update: Json): void {
    const toolCallId = String(update.toolCallId);
    const existing = this.tools.get(toolCallId);
    const node: ToolCallNode = existing
      ? { ...existing }
      : {
          id: `${this.prefix}-tool-${toolCallId}`,
          kind: 'tool_call',
          parentId: null,
          createdAt: Date.now(),
          tool: 'other',
          name: 'tool',
          title: 'Tool call',
          input: {},
          output: '',
          files: [],
          status: 'running',
        };
    if (typeof update.title === 'string') node.title = update.title;
    if (update.kind !== undefined) {
      node.tool = toolKind(update.kind);
      node.name = String(update.kind);
    }
    if (update.status !== undefined) node.status = toolStatus(update.status);
    if (update.rawInput !== undefined) {
      node.input = update.rawInput;
      const command = (update.rawInput as Json).command;
      if (node.tool === 'command' && typeof command === 'string') node.command = command;
    }
    if (update.content !== undefined) {
      const text = contentText(update.content);
      if (text) node.output = text;
      const files = contentFiles(update.content);
      if (files.length) node.files = files;
    }
    if (update.rawOutput !== undefined && !node.output) {
      const raw = update.rawOutput as Json;
      node.output = typeof raw === 'string' ? raw : typeof raw.output === 'string' ? raw.output : JSON.stringify(raw);
    }
    this.tools.set(toolCallId, node);
    this.emit(node);
  }

  async request(method: string, params: Json): Promise<unknown> {
    if (method !== 'session/request_permission') throw new RpcError(-32601, `Ouijit does not provide ${method}`);
    const toolCall = (params.toolCall ?? {}) as Json;
    const options = Array.isArray(params.options) ? (params.options as Json[]) : [];
    const answer = await this.sink.ask({
      id: `${this.prefix}-permission-${String(toolCall.toolCallId)}-${Date.now()}`,
      parentId: null,
      request: 'approval',
      title:
        typeof toolCall.title === 'string'
          ? toolCall.title
          : (this.tools.get(String(toolCall.toolCallId))?.title ?? 'Allow this?'),
      toolCallId: `${this.prefix}-tool-${String(toolCall.toolCallId)}`,
      options: options.map((option) => ({
        id: String(option.optionId),
        label: String(option.name),
        kind: optionKind(option.kind),
      })),
      questions: [],
    });
    if (answer.kind === 'option') return { outcome: { outcome: 'selected', optionId: answer.optionId } };
    return { outcome: { outcome: 'cancelled' } };
  }

  private async blocks(input: UserInput): Promise<Json[]> {
    const blocks: Json[] = [];
    if (input.text) blocks.push({ type: 'text', text: input.text });
    for (const attachment of input.attachments) {
      if (attachment.mimeType.startsWith('image/') && this.capabilities.images) {
        const data = await readFile(attachment.path);
        blocks.push({ type: 'image', mimeType: attachment.mimeType, data: data.toString('base64') });
      } else {
        blocks.push({
          type: 'resource_link',
          uri: `file://${attachment.path}`,
          name: attachment.name,
          mimeType: attachment.mimeType,
        });
      }
    }
    return blocks;
  }

  async prompt(input: UserInput): Promise<void> {
    this.turn++;
    this.stream = null;
    const prompt = await this.blocks(input);
    this.sink.session({ status: 'running' });
    void this.rpc
      .request<Json>('session/prompt', { sessionId: this.sessionId, prompt })
      .then((result) => {
        this.finishStreams();
        if (result.stopReason === 'refusal') this.notice('warning', 'The agent refused this request');
        else if (result.stopReason === 'max_tokens') this.notice('warning', 'The agent hit its token limit');
        this.sink.session({ status: 'idle' });
      })
      .catch((error: unknown) => {
        if (this.closing) return;
        this.finishStreams();
        this.notice('error', error instanceof Error ? error.message : String(error));
        this.sink.session({ status: 'idle' });
      });
  }

  private finishStreams(): void {
    this.stream = null;
    for (const [id, open] of this.streaming) {
      this.sink.node({
        id,
        kind: open.kind,
        parentId: null,
        createdAt: open.createdAt,
        text: open.text,
        status: 'completed',
      });
    }
    this.streaming.clear();
  }

  async send(input: UserInput): Promise<void> {
    await this.prompt(input);
  }

  async interrupt(): Promise<void> {
    this.rpc.notify('session/cancel', { sessionId: this.sessionId });
  }

  async setMode(mode: string): Promise<void> {
    await this.rpc.request('session/set_mode', { sessionId: this.sessionId, modeId: mode });
  }

  async setModel(model: string): Promise<void> {
    await this.rpc.request('session/set_model', { sessionId: this.sessionId, modelId: model });
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.sink.node({
      id: `${this.prefix}-notice-${Date.now()}-${this.counter++}`,
      kind: 'notice',
      parentId: null,
      createdAt: Date.now(),
      level,
      text,
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.rpc.dispose();
    this.proc.stdin.end();
    await terminate(this.proc);
  }
}

/** Run any ACP agent over stdio, for `acp` and for agents whose own protocol is ACP. */
export async function startAcpSession(
  context: DriverContext,
  command: string,
  args: string[],
  prefix: string,
  label: string,
): Promise<AcpSession> {
  const proc = await context.spawn({ command, args });
  const tail = stderrTail(proc);
  let session: AcpSession | null = null;
  const rpc = new JsonRpcPeer(
    proc,
    {
      notification: (method, params) => session?.notification(method, (params ?? {}) as Json),
      request: async (method, params) => {
        if (!session) throw new RpcError(-32603, 'not ready');
        return session.request(method, (params ?? {}) as Json);
      },
    },
    { envelope: true, log: context.sink.log },
  );
  session = new AcpSession(rpc, context.sink, proc, prefix);
  void exited(proc).then((code) => {
    if (session?.closing) return;
    context.sink.session({
      status: code === 0 ? 'exited' : 'error',
      statusDetail: tail() || `${label} exited (code ${code ?? 'signal'})`,
    });
  });
  try {
    await session.open(context.cwd, context.resume);
  } catch (error) {
    await session.close();
    throw new Error(tail() || (error instanceof Error ? error.message : String(error)));
  }
  return session;
}

export const acpDriver: AgentDriver = {
  id: 'acp',
  label: 'ACP agent',

  async probe() {
    return { installed: true };
  },

  async start(context) {
    const [command, ...args] = splitCommand(context.preferences.acpCommand);
    if (!command) throw new Error('Set the ACP agent command in Settings → Chat to use an ACP agent.');
    const resolved = command.includes('/') ? command : (resolveAgentBinary(command) ?? command);
    return startAcpSession(context, resolved, args, 'acp', command);
  },

  terminalResume() {
    return null;
  },
};
