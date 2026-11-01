import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { binaryVersion, compareVersions, resolveAgentBinary } from '../binaries';
import { exited, onLines, stderrTail, terminate, type AgentProcess } from '../process';
import { startAcpSession } from './acp';
import type { AgentDriver, DriverContext, DriverSession, DriverSink, UserInput } from '../driver';
import type { ChatCapabilities, ChatNode, ChatOption, FileChange, ToolCallNode, ToolKind } from '../model';

/** The `/api` server this driver speaks arrived with opencode 2. Older releases go through `opencode acp`. */
const OPENCODE_SERVER_VERSION = '2.0.0';

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
    case 'shell':
      return 'command';
    case 'read':
      return 'read';
    case 'edit':
    case 'write':
    case 'patch':
    case 'apply_patch':
    case 'multiedit':
      return 'edit';
    case 'grep':
    case 'glob':
    case 'list':
      return 'search';
    case 'webfetch':
    case 'websearch':
      return 'fetch';
    case 'task':
    case 'subagent':
      return 'subagent';
    default:
      return name.includes('_') && !name.startsWith('todo') ? 'mcp' : 'other';
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toolTitle(name: string, input: Json): string {
  const path = str(input.filePath) ?? str(input.path) ?? str(input.file_path);
  switch (toolKind(name)) {
    case 'command':
      return str(input.description) ?? str(input.command) ?? 'Run a command';
    case 'read':
      return `Read ${path ?? 'a file'}`;
    case 'edit':
      return `Edit ${path ?? 'files'}`;
    case 'search':
      return `Search for ${str(input.pattern) ?? str(input.query) ?? ''}`.trim();
    case 'fetch':
      return `Fetch ${str(input.url) ?? str(input.query) ?? ''}`.trim();
    case 'subagent':
      return str(input.description) ?? 'Run a subagent';
    default:
      return name;
  }
}

function toolContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part: Json) => (part.type === 'text' ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

function toolFiles(name: string, input: Json, metadata: unknown): FileChange[] {
  if (toolKind(name) !== 'edit') return [];
  const meta = (metadata ?? {}) as Json;
  const path = str(input.filePath) ?? str(input.path) ?? str(meta.filePath);
  const diff = str(meta.diff);
  return path ? [{ path, change: name === 'write' ? 'add' : 'modify', diff }] : [];
}

function messageNodeId(messageId: string, kind: 'text' | 'reasoning', ordinal: number): string {
  return `oc-${messageId}-${kind}-${ordinal}`;
}

function newTool(id: string, name: string, input: Json, parentId: string | null): ToolCallNode {
  return {
    id: `oc-tool-${id}`,
    kind: 'tool_call',
    parentId,
    createdAt: Date.now(),
    tool: toolKind(name),
    name,
    title: toolTitle(name, input),
    input,
    command: toolKind(name) === 'command' ? str(input.command) : undefined,
    output: '',
    files: [],
    status: 'running',
  };
}

function opencodeHistoryNodes(messages: Json[], parentId: string | null = null): ChatNode[] {
  const nodes: ChatNode[] = [];
  for (const message of messages) {
    const time = (message.time ?? {}) as Json;
    const createdAt = typeof time.created === 'number' ? time.created : Date.now();
    if (message.type === 'user') {
      nodes.push({
        id: `oc-user-${String(message.id)}`,
        kind: 'user_message',
        parentId,
        createdAt,
        text: String(message.text ?? ''),
        attachments: [],
        delivery: 'prompt',
      });
    } else if (message.type === 'assistant') {
      const ordinals = { text: 0, reasoning: 0 };
      for (const part of (Array.isArray(message.content) ? message.content : []) as Json[]) {
        if (part.type === 'text' || part.type === 'reasoning') {
          const kind = part.type;
          nodes.push({
            id: messageNodeId(String(message.id), kind, ordinals[kind]++),
            kind: kind === 'text' ? 'assistant_message' : 'reasoning',
            parentId,
            createdAt,
            text: String(part.text ?? ''),
            status: 'completed',
          } as ChatNode);
        } else if (part.type === 'tool') {
          const state = (part.state ?? {}) as Json;
          const input = (state.input ?? {}) as Json;
          const node = newTool(String(part.id), String(part.name), input, parentId);
          nodes.push({
            ...node,
            createdAt,
            output: toolContent(state.content),
            files: toolFiles(node.name, input, state.metadata),
            status: state.status === 'completed' ? 'completed' : state.status === 'error' ? 'failed' : 'running',
          });
        }
      }
    } else if (message.type === 'compaction') {
      nodes.push({ id: `oc-compact-${String(message.id)}`, kind: 'compaction', parentId, createdAt, trigger: 'auto' });
    }
  }
  return nodes;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });
}

class OpencodeSession implements DriverSession {
  readonly capabilities = CAPABILITIES;
  private sessionId = '';
  private readonly tools = new Map<string, ToolCallNode>();
  private readonly children = new Map<string, string>();
  private readonly sentMessages = new Map<string, string>();
  private model: { id: string; providerID: string; variant?: string } | null = null;
  private variants = new Map<string, string[]>();
  private commands = new Set<string>();
  private events: AbortController | null = null;
  closing = false;

  constructor(
    private readonly url: string,
    private readonly password: string,
    private readonly proc: AgentProcess,
    private readonly sink: DriverSink,
  ) {}

  private async call<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(path, this.url), {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`opencode ${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private instructions = '';

  async open(resume: DriverContext['resume'], instructions: string): Promise<void> {
    this.instructions = instructions;
    void this.subscribe();
    if (resume?.fork) {
      const { data } = await this.call<{ data: Json }>('POST', `/api/session/${resume.agentSessionId}/fork`, {});
      this.sessionId = String(data.id);
    } else if (resume) {
      this.sessionId = resume.agentSessionId;
    } else {
      const { data } = await this.call<{ data: Json }>('POST', '/api/session', {});
      this.sessionId = String(data.id);
    }
    if (instructions) {
      await this.call('PUT', `/api/experimental/session/${this.sessionId}/instructions/entries/ouijit`, {
        value: instructions,
      }).catch((error: unknown) => this.sink.log('opencode instructions not set', { error: String(error) }));
    }
    this.sink.session({ agentSessionId: this.sessionId });
    if (resume) this.sink.history(opencodeHistoryNodes(await this.messages()));
    void this.loadMetadata();
  }

  /** The whole conversation, oldest first, a page at a time: the server serves at most 200 per request. */
  private async messages(): Promise<Json[]> {
    const all: Json[] = [];
    let cursor: string | null = null;
    do {
      // The cursor carries the order it was issued for; the server refuses both together.
      const query = new URLSearchParams(cursor ? { limit: '200', cursor } : { order: 'asc', limit: '200' });
      const page: { data: Json[]; cursor?: { next?: string | null } } = await this.call(
        'GET',
        `/api/session/${this.sessionId}/message?${query}`,
      );
      all.push(...page.data);
      cursor = page.data.length ? (page.cursor?.next ?? null) : null;
    } while (cursor);
    return all;
  }

  private async loadMetadata(): Promise<void> {
    try {
      const [{ data: session }, { data: models }, { data: commands }] = await Promise.all([
        this.call<{ data: Json }>('GET', `/api/session/${this.sessionId}`),
        this.call<{ data: Json[] }>('GET', '/api/model'),
        this.call<{ data: Json[] }>('GET', '/api/command'),
      ]);
      const current = session.model as Json | undefined;
      if (current)
        this.model = { id: String(current.id), providerID: String(current.providerID), variant: str(current.variant) };
      const options: ChatOption[] = models
        .filter((model) => model.enabled !== false)
        .map((model) => {
          const id = `${String(model.providerID)}/${String(model.modelID ?? model.id)}`;
          this.variants.set(
            id,
            Array.isArray(model.variants) ? (model.variants as Json[]).map((v) => String(v.id)) : [],
          );
          return { id, label: String(model.name ?? model.id), description: String(model.providerID) };
        });
      this.commands = new Set(commands.map((command) => String(command.name)));
      const modelId = this.model ? `${this.model.providerID}/${this.model.id}` : undefined;
      this.sink.session({
        models: options,
        model: modelId,
        efforts: (modelId ? (this.variants.get(modelId) ?? []) : []).map((variant) => ({
          id: variant,
          label: variant,
        })),
        effort: this.model?.variant,
        commands: commands.map((command) => ({ name: String(command.name), description: str(command.description) })),
      });
    } catch (error) {
      this.sink.log('opencode metadata load failed', { error: String(error) });
    }
  }

  /** The event stream is volatile by contract, so a dropped one reconnects rather than ending the session. */
  private async subscribe(): Promise<void> {
    while (!this.closing) {
      this.events = new AbortController();
      try {
        const response = await fetch(new URL('/api/event', this.url), {
          headers: {
            authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`,
            accept: 'text/event-stream',
          },
          signal: this.events.signal,
        });
        if (!response.body) throw new Error('no event stream');
        let buffer = '';
        const decoder = new TextDecoder();
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            if (data) this.event(data);
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (error) {
        if (this.closing) return;
        this.sink.log('opencode event stream dropped', { error: String(error) });
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private parentFor(sessionId: string): string | null | undefined {
    if (sessionId === this.sessionId) return null;
    return this.children.get(sessionId);
  }

  private event(raw: string): void {
    let event: Json;
    try {
      event = JSON.parse(raw) as Json;
    } catch {
      return;
    }
    const type = String(event.type);
    const data = (event.data ?? {}) as Json;
    if (type === 'session.created') {
      const info = (data.info ?? data) as Json;
      if (info.parentID === this.sessionId || this.children.has(String(info.parentID))) {
        const id = `oc-session-${String(info.id)}`;
        this.children.set(String(info.id), id);
        this.sink.node({
          id,
          kind: 'subagent',
          parentId: null,
          createdAt: Date.now(),
          title: String(info.title ?? 'Subagent'),
          status: 'running',
        });
      }
      return;
    }
    const sessionId = str(data.sessionID);
    if (!sessionId) return;
    const parentId = this.parentFor(sessionId);
    if (parentId === undefined) return;
    const top = parentId === null;
    switch (type) {
      case 'session.execution.started':
        if (top) this.sink.session({ status: 'running' });
        return;
      case 'session.execution.succeeded':
      case 'session.execution.interrupted':
        if (top) this.sink.session({ status: 'idle' });
        else this.finishChild(sessionId, 'completed');
        return;
      case 'session.execution.failed': {
        const error = (data.error ?? {}) as Json;
        this.notice('error', String(error.message ?? 'opencode reported an error'), parentId);
        if (top) this.sink.session({ status: 'idle' });
        else this.finishChild(sessionId, 'failed');
        return;
      }
      case 'session.text.started':
      case 'session.reasoning.started': {
        const kind = type === 'session.text.started' ? 'text' : 'reasoning';
        this.sink.node({
          id: messageNodeId(String(data.assistantMessageID), kind, Number(data.ordinal ?? 0)),
          kind: kind === 'text' ? 'assistant_message' : 'reasoning',
          parentId,
          createdAt: Date.now(),
          text: '',
          status: 'running',
        } as ChatNode);
        return;
      }
      case 'session.text.delta':
      case 'session.reasoning.delta': {
        const kind = type === 'session.text.delta' ? 'text' : 'reasoning';
        this.sink.append(
          messageNodeId(String(data.assistantMessageID), kind, Number(data.ordinal ?? 0)),
          'text',
          String(data.delta ?? ''),
        );
        return;
      }
      case 'session.text.ended':
      case 'session.reasoning.ended': {
        const kind = type === 'session.text.ended' ? 'text' : 'reasoning';
        this.sink.node({
          id: messageNodeId(String(data.assistantMessageID), kind, Number(data.ordinal ?? 0)),
          kind: kind === 'text' ? 'assistant_message' : 'reasoning',
          parentId,
          createdAt: Date.now(),
          text: String(data.text ?? ''),
          status: 'completed',
        } as ChatNode);
        return;
      }
      case 'session.tool.input.started': {
        const node = newTool(String(data.id), String(data.name), {}, parentId);
        this.tools.set(String(data.id), node);
        this.sink.node({ ...node, status: 'pending' });
        return;
      }
      case 'session.tool.called': {
        const existing = this.tools.get(String(data.id));
        const input = (data.input ?? {}) as Json;
        const name = existing?.name ?? String(data.name ?? 'tool');
        const node = {
          ...newTool(String(data.id), name, input, parentId),
          createdAt: existing?.createdAt ?? Date.now(),
        };
        this.tools.set(String(data.id), node);
        this.sink.node(node);
        return;
      }
      case 'session.tool.progress': {
        const node = this.tools.get(String(data.id));
        const metadata = (data.metadata ?? {}) as Json;
        if (node && typeof metadata.output === 'string') {
          const updated = { ...node, output: metadata.output };
          this.tools.set(String(data.id), updated);
          this.sink.node(updated);
        }
        return;
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const node = this.tools.get(String(data.id));
        if (!node) return;
        this.tools.delete(String(data.id));
        const error = (data.error ?? {}) as Json;
        this.sink.node({
          ...node,
          output: toolContent(data.content) || (type === 'session.tool.failed' ? String(error.message ?? '') : ''),
          files: toolFiles(node.name, node.input as Json, data.metadata),
          status: type === 'session.tool.success' ? 'completed' : 'failed',
        });
        return;
      }
      case 'session.compaction.ended':
        this.sink.node({
          id: `oc-compact-${Date.now()}`,
          kind: 'compaction',
          parentId,
          createdAt: Date.now(),
          trigger: 'auto',
        });
        return;
      case 'session.retry.scheduled':
        this.notice('warning', `Retrying: ${String(data.message ?? 'transient error')}`, parentId);
        return;
      case 'session.usage.updated': {
        if (!top) return;
        const tokens = (data.tokens ?? {}) as Json;
        this.sink.session({
          usage: {
            inputTokens: Number(tokens.input ?? 0),
            outputTokens: Number(tokens.output ?? 0),
          },
        });
        return;
      }
      case 'permission.asked':
        void this.permission(data, parentId);
        return;
      case 'form.created':
        return;
    }
  }

  private finishChild(sessionId: string, status: 'completed' | 'failed'): void {
    const id = this.children.get(sessionId);
    if (id) this.sink.node({ id, kind: 'subagent', parentId: null, createdAt: Date.now(), title: 'Subagent', status });
  }

  private async permission(request: Json, parentId: string | null): Promise<void> {
    const resources = Array.isArray(request.resources) ? request.resources.map(String) : [];
    const answer = await this.sink.ask({
      id: `oc-permission-${String(request.id)}`,
      parentId,
      request: 'approval',
      title: str(request.message) ?? `${String(request.action)} ${resources.join(', ')}`.trim(),
      detail: resources.length ? resources.join('\n') : undefined,
      options: [
        { id: 'once', label: 'Allow', kind: 'allow_once' },
        { id: 'always', label: 'Always allow', kind: 'allow_always' },
        { id: 'reject', label: 'Reject', kind: 'reject_once' },
      ],
      questions: [],
    });
    const decision = answer.kind === 'option' ? answer.optionId : 'reject';
    const message = answer.kind === 'option' ? answer.message : undefined;
    await this.call('POST', `/api/session/${String(request.sessionID)}/permission/${String(request.id)}/reply`, {
      decision,
      ...(message && { message }),
    }).catch((error: unknown) => this.sink.log('opencode permission reply failed', { error: String(error) }));
  }

  private notice(level: 'info' | 'warning' | 'error', text: string, parentId: string | null): void {
    this.sink.node({
      id: `oc-notice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'notice',
      parentId,
      createdAt: Date.now(),
      level,
      text,
    });
  }

  private async files(input: UserInput): Promise<Json[]> {
    const files: Json[] = [];
    for (const attachment of input.attachments) {
      if (attachment.mimeType.startsWith('image/')) {
        const data = await readFile(attachment.path);
        files.push({ uri: `data:${attachment.mimeType};base64,${data.toString('base64')}`, name: attachment.name });
      } else {
        files.push({ uri: `file://${attachment.path}`, name: attachment.name });
      }
    }
    return files;
  }

  private async deliver(input: UserInput, delivery?: 'steer' | 'queue'): Promise<void> {
    const files = await this.files(input);
    const command = input.text.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (command && this.commands.has(command[1])) {
      await this.call('POST', `/api/session/${this.sessionId}/command`, {
        name: command[1],
        text: command[2],
        ...(files.length && { files }),
        ...(delivery && { delivery }),
      });
      return;
    }
    const { data } = await this.call<{ data: Json }>('POST', `/api/session/${this.sessionId}/prompt`, {
      text: input.text,
      ...(files.length && { files }),
      ...(delivery && { delivery }),
    });
    if (data?.id) this.sentMessages.set(input.id, String(data.id));
  }

  async prompt(input: UserInput): Promise<void> {
    await this.deliver(input);
  }

  async send(input: UserInput, delivery: 'steer' | 'queue'): Promise<void> {
    await this.deliver(input, delivery);
  }

  async interrupt(): Promise<void> {
    await this.call('POST', `/api/session/${this.sessionId}/interrupt`);
  }

  async setModel(model: string): Promise<void> {
    const slash = model.indexOf('/');
    this.model = { providerID: model.slice(0, slash), id: model.slice(slash + 1) };
    await this.call('POST', `/api/session/${this.sessionId}/model`, { model: this.model });
    this.sink.session({
      efforts: (this.variants.get(model) ?? []).map((variant) => ({ id: variant, label: variant })),
    });
  }

  async setEffort(effort: string): Promise<void> {
    if (!this.model) throw new Error('Pick a model first');
    this.model = { ...this.model, variant: effort };
    await this.call('POST', `/api/session/${this.sessionId}/model`, { model: this.model });
  }

  async rewind(userMessageId: string): Promise<void> {
    const messageID =
      this.sentMessages.get(userMessageId) ?? (userMessageId.startsWith('oc-user-') ? userMessageId.slice(8) : null);
    if (!messageID) throw new Error('opencode has no record of that message');
    await this.call('POST', `/api/session/${this.sessionId}/revert/stage`, { messageID, files: true });
    await this.call('POST', `/api/session/${this.sessionId}/revert/commit`);
  }

  async clear(): Promise<void> {
    const { data } = await this.call<{ data: Json }>('POST', '/api/session', {});
    this.sessionId = String(data.id);
    this.tools.clear();
    this.children.clear();
    this.sentMessages.clear();
    if (this.instructions) {
      await this.call('PUT', `/api/experimental/session/${this.sessionId}/instructions/entries/ouijit`, {
        value: this.instructions,
      }).catch((error: unknown) => this.sink.log('opencode instructions not set', { error: String(error) }));
    }
    this.sink.reset();
    this.sink.session({ agentSessionId: this.sessionId });
  }

  async compact(): Promise<void> {
    await this.call('POST', `/api/session/${this.sessionId}/compact`, {});
  }

  async close(): Promise<void> {
    this.closing = true;
    this.events?.abort();
    this.proc.stdin.end();
    await terminate(this.proc);
  }
}

async function startServer(context: DriverContext, binary: string): Promise<DriverSession> {
  const password = randomBytes(24).toString('hex');
  const port = await freePort();
  const proc = await context.spawn({
    command: binary,
    args: ['serve', '--stdio', '--port', String(port), '--hostname', '127.0.0.1'],
    env: { OPENCODE_PASSWORD: password },
  });
  const tail = stderrTail(proc);
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(tail() || 'opencode did not start its server')), 30_000);
    const stop = onLines(proc.stdout, (line) => {
      try {
        const message = JSON.parse(line) as Json;
        if (typeof message.url === 'string') {
          clearTimeout(timer);
          stop();
          resolve(message.url);
        }
      } catch {
        return;
      }
    });
    void exited(proc).then((code) => {
      clearTimeout(timer);
      reject(new Error(tail() || `opencode exited (code ${code ?? 'signal'})`));
    });
  });
  const session = new OpencodeSession(url, password, proc, context.sink);
  void exited(proc).then((code) => {
    if (session.closing) return;
    context.sink.session({
      status: code === 0 ? 'exited' : 'error',
      statusDetail: tail() || `opencode exited (code ${code ?? 'signal'})`,
    });
  });
  try {
    await session.open(context.resume, context.instructions);
  } catch (error) {
    await session.close();
    throw error;
  }
  return session;
}

export const opencodeDriver: AgentDriver = {
  id: 'opencode',
  label: 'opencode',

  async probe() {
    const binary = resolveAgentBinary('opencode');
    if (!binary) return { installed: false, problem: 'opencode is not installed. Install it from opencode.ai.' };
    return { installed: true, version: await binaryVersion(binary) };
  },

  async start(context) {
    const binary = resolveAgentBinary('opencode');
    if (!binary) throw new Error('opencode is not installed');
    const version = await binaryVersion(binary);
    if (version && compareVersions(version, OPENCODE_SERVER_VERSION) < 0) {
      return startAcpSession(context, binary, ['acp'], 'oc', 'opencode');
    }
    return startServer(context, binary);
  },

  terminalResume(agentSessionId) {
    return { file: 'opencode', args: agentSessionId ? ['--session', agentSessionId] : [] };
  },
};
