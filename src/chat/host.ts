import { randomUUID } from 'node:crypto';
import { getLogger } from '../logger';
import { getChatRepo, getGlobalSetting } from '../db';
import { CHAT_SETTING_KEYS, parseChatSettings } from './preferences';
import type { ChatSessionRow } from '../db/repos/chatRepo';
import { issueToken, revokeToken } from '../apiAuth';
import { hostEnv, ouijitSessionEnv, sandboxLaunch, sandboxReferenceEnv } from '../sessionEnv';
import { getCliReferencePath } from '../hookServer';
import { readCliReference } from './binaries';
import { getSandboxProvider } from '../sandbox';
import { isActiveSandbox, isSandboxProviderId, type SandboxProviderId } from '../sandbox/types';
import { spawnAgentProcess, type AgentProcess, type AgentSpawn } from './process';
import { getDriver } from './drivers';
import type { DriverProbe, DriverSession, DriverSink, UserInput } from './driver';
import {
  NO_CAPABILITIES,
  applyChatEvent,
  isChatAgentId,
  type ChatAgentId,
  type ChatAnswer,
  type ChatAttachment,
  type ChatCommand,
  type ChatOption,
  type SlashCommand,
  parseSlashCommand,
  type ChatEvent,
  type ChatNode,
  type ChatSessionInfo,
  type ChatSnapshot,
  type RequestNode,
  type SequencedChatEvent,
  type UserMessageNode,
} from './model';

const chatLog = getLogger().scope('chat');

const FLUSH_DELAY_MS = 300;
/** The conversation commands a driver can run, which every chat's menu offers whatever the agent lists. */
function conversationCommands(driver: DriverSession): ChatCommand[] {
  return [
    { name: 'clear', description: 'Start a new conversation', available: Boolean(driver.clear) },
    {
      name: 'compact',
      description: 'Summarize the conversation to free up context',
      available: Boolean(driver.compact),
    },
    { name: 'model', description: 'Switch model', argumentHint: '<model>', available: Boolean(driver.setModel) },
    {
      name: 'effort',
      description: 'Set reasoning effort',
      argumentHint: '<level>',
      available: Boolean(driver.setEffort),
    },
  ]
    .filter((command) => command.available)
    .map(({ available: _available, ...command }) => command);
}

/**
 * Nodes still running once their agent process is gone, settled: nothing will
 * report them finished. A subagent whose launching call completed is done.
 */
function settled(nodes: ChatNode[]): ChatNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.flatMap((node) => {
    if (node.kind === 'request' || !('status' in node)) return [];
    if (node.status !== 'running' && node.status !== 'pending') return [];
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const done = node.kind === 'subagent' && parent?.kind === 'tool_call' && parent.status === 'completed';
    return [{ ...node, status: done ? 'completed' : 'interrupted' } as ChatNode];
  });
}

function withConversationCommands(commands: ChatCommand[], driver: DriverSession): ChatCommand[] {
  const own = conversationCommands(driver).filter((command) => !commands.some((c) => c.name === command.name));
  return [...own, ...commands];
}
/** Events kept for a client catching up; one that falls further behind takes a fresh snapshot. */
const REPLAY_WINDOW = 4000;

export interface ChatStartOptions {
  /** The card's id. A stored session under it resumes; otherwise a new one starts under it. */
  id?: string;
  agent: ChatAgentId;
  projectPath: string;
  cwd: string;
  taskId: number | null;
  worktreePath?: string;
  sandboxProvider?: SandboxProviderId;
  label?: string;
  /** Start from an agent conversation that began outside this session, e.g. in the card's terminal. */
  resume?: { agentSessionId: string; fork: boolean };
  /** Return once the session exists, while the agent is still launching; the launch arrives as events. */
  eager?: boolean;
}

export type ChatDelivery = 'auto' | 'steer' | 'queue';

export type ChatListener = (sessionId: string, event: SequencedChatEvent) => void;

export class ChatSessionNotFound extends Error {
  constructor(id: string) {
    super(`Chat session ${id} not found`);
  }
}

interface Pending {
  resolve: (answer: ChatAnswer) => void;
}

class HostedSession {
  info: ChatSessionInfo;
  nodes: ChatNode[] = [];
  seq = 0;
  driver: DriverSession | null = null;
  readonly asks = new Map<string, Pending>();
  readonly queued: UserMessageNode[] = [];
  private readonly recent: SequencedChatEvent[] = [];
  private dirty = new Set<string>();
  private removed = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly createdAt: string;
  readonly processes = new Set<AgentProcess>();
  starting: Promise<void> | null = null;
  stopping: Promise<void> | null = null;
  referenceEnv: Record<string, string> = {};

  constructor(
    readonly row: Pick<ChatSessionRow, 'id' | 'project_path' | 'task_id' | 'cwd' | 'worktree_path' | 'agent'> & {
      sandbox_provider: SandboxProviderId | undefined;
    },
    info: ChatSessionInfo,
    createdAt: string,
    private readonly broadcast: ChatListener,
  ) {
    this.info = info;
    this.createdAt = createdAt;
  }

  emit(event: ChatEvent): void {
    applyChatEvent(this, event);
    const sequenced = { seq: ++this.seq, event };
    this.recent.push(sequenced);
    if (this.recent.length > REPLAY_WINDOW) this.recent.splice(0, this.recent.length - REPLAY_WINDOW);
    this.track(event);
    this.broadcast(this.info.id, sequenced);
  }

  since(seq: number): SequencedChatEvent[] | null {
    if (seq >= this.seq) return [];
    const first = this.recent[0];
    if (!first || first.seq > seq + 1) return null;
    return this.recent.filter((entry) => entry.seq > seq);
  }

  snapshot(): ChatSnapshot {
    return { info: this.info, nodes: this.nodes, seq: this.seq };
  }

  private track(event: ChatEvent): void {
    if (event.type === 'node') {
      this.dirty.add(event.node.id);
      this.removed.delete(event.node.id);
    } else if (event.type === 'append') {
      this.dirty.add(event.id);
    } else if (event.type === 'remove') {
      for (const id of event.ids) {
        this.dirty.delete(id);
        this.removed.add(id);
      }
    }
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const positions = new Map(this.nodes.map((node, index) => [node.id, index]));
    const upserts = [...this.dirty].flatMap((id) => {
      const position = positions.get(id);
      if (position === undefined) return [];
      return [{ nodeId: id, position, body: JSON.stringify(this.nodes[position]) }];
    });
    // Positions shift when a remove or a mid-list insert lands, so every node
    // after the first change is rewritten with its new position.
    const firstChange = Math.min(...upserts.map((u) => u.position), this.removed.size ? 0 : Infinity);
    if (Number.isFinite(firstChange)) {
      const written = new Set(upserts.map((u) => u.nodeId));
      for (let index = firstChange; index < this.nodes.length; index++) {
        const node = this.nodes[index];
        if (!written.has(node.id)) upserts.push({ nodeId: node.id, position: index, body: JSON.stringify(node) });
      }
    }
    try {
      getChatRepo().save(
        {
          ...this.row,
          sandbox_provider: this.row.sandbox_provider ?? null,
          agent_session_id: this.info.agentSessionId,
          info: JSON.stringify(persistedInfo(this.info)),
          seq: this.seq,
          created_at: this.createdAt,
          updated_at: new Date().toISOString(),
        },
        upserts,
        [...this.removed],
      );
      this.dirty.clear();
      this.removed.clear();
    } catch (error) {
      chatLog.error('failed to persist chat session', { id: this.info.id, error: String(error) });
    }
  }
}

/** What survives a restart: the conversation's settings, not the live process state. */
function persistedInfo(info: ChatSessionInfo): ChatSessionInfo {
  const status = info.status === 'error' ? 'error' : 'exited';
  return { ...info, status, statusDetail: info.status === 'error' ? info.statusDetail : undefined };
}

export interface ChatHostOptions {
  spawnProcess?: typeof spawnAgentProcess;
}

export class ChatHost {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly listeners = new Set<ChatListener>();
  private readonly probed = new Map<ChatAgentId, DriverProbe>();

  constructor(private options: ChatHostOptions = {}) {}

  /** Test-only: put a recorded agent behind the app's own host. */
  _setOptionsForTesting(options: ChatHostOptions): void {
    this.options = options;
  }

  subscribe(listener: ChatListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isLive(id: string): boolean {
    return this.sessions.has(id);
  }

  list(): ChatSessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info);
  }

  context(id: string): { projectPath: string; taskId: number | null; cwd: string } | null {
    const session = this.sessions.get(id);
    return session
      ? { projectPath: session.info.projectPath, taskId: session.info.taskId, cwd: session.info.cwd }
      : null;
  }

  /** A live session's snapshot, or a stored one's when it is not running. */
  snapshot(id: string): ChatSnapshot | null {
    const live = this.sessions.get(id);
    if (live) return live.snapshot();
    const row = getChatRepo().get(id);
    return row ? storedSnapshot(row) : null;
  }

  since(id: string, seq: number): SequencedChatEvent[] | null {
    return this.sessions.get(id)?.since(seq) ?? null;
  }

  /**
   * The events after `seq`, waiting up to `waitMs` for the first one when
   * there are none yet: a long poll, so a client over plain HTTP can follow a
   * chat live. Null when `seq` has fallen out of the replay window.
   */
  async waitFor(id: string, seq: number, waitMs: number): Promise<SequencedChatEvent[] | null> {
    const ready = this.since(id, seq);
    if (ready === null || ready.length > 0 || waitMs <= 0) return ready;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, waitMs);
      const unsubscribe = this.subscribe((sessionId) => {
        if (sessionId === id) done();
      });
      function done() {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
    return this.since(id, seq);
  }

  /** The most recent stored session of a task. */
  latestForTask(projectPath: string, taskId: number): ChatSnapshot | null {
    const [row] = getChatRepo().listForTask(projectPath, taskId);
    return row ? (this.snapshot(row.id) ?? storedSnapshot(row)) : null;
  }

  async start(options: ChatStartOptions): Promise<ChatSnapshot> {
    const id = options.id ?? `pty-${randomUUID()}`;
    const live = this.sessions.get(id);
    if (live?.stopping) await live.stopping;
    else if (live) {
      await live.starting;
      return live.snapshot();
    }

    const stored = getChatRepo().get(id);
    const agent = stored && isChatAgentId(stored.agent) ? stored.agent : options.agent;
    const sandboxProvider = stored
      ? isSandboxProviderId(stored.sandbox_provider)
        ? stored.sandbox_provider
        : undefined
      : options.sandboxProvider;
    const base: ChatSessionInfo = stored
      ? (JSON.parse(stored.info) as ChatSessionInfo)
      : {
          id,
          ...(options.label && { label: options.label }),
          agent,
          agentSessionId: null,
          projectPath: options.projectPath,
          cwd: options.cwd,
          worktreePath: options.worktreePath ?? null,
          sandbox: isActiveSandbox(options.sandboxProvider) ? options.sandboxProvider : null,
          taskId: options.taskId,
          status: 'starting',
          capabilities: NO_CAPABILITIES,
          models: [],
          efforts: [],
          modes: [],
          commands: [],
        };
    const session = new HostedSession(
      {
        id,
        project_path: stored?.project_path ?? options.projectPath,
        task_id: stored ? stored.task_id : options.taskId,
        cwd: stored?.cwd ?? options.cwd,
        worktree_path: stored ? stored.worktree_path : (options.worktreePath ?? null),
        agent,
        sandbox_provider: sandboxProvider,
      },
      { ...base, status: 'starting', statusDetail: undefined },
      stored?.created_at ?? new Date().toISOString(),
      (sessionId, event) => this.broadcast(sessionId, event),
    );
    if (stored)
      session.nodes = getChatRepo()
        .nodes(id)
        .map((body) => JSON.parse(body) as ChatNode);
    session.seq = stored?.seq ?? 0;
    for (const node of settled(session.nodes)) session.emit({ type: 'node', node });
    this.sessions.set(id, session);

    const resume =
      options.resume ?? (base.agentSessionId ? { agentSessionId: base.agentSessionId, fork: false } : null);
    if (options.resume)
      session.info = { ...session.info, agentSessionId: options.resume.fork ? null : options.resume.agentSessionId };
    session.starting = this.launch(session, resume);
    if (!options.eager) await session.starting;
    return session.snapshot();
  }

  /** A version check spawns the agent's binary, so one that passed holds for the rest of the run. */
  private async probe(agent: ChatAgentId): Promise<DriverProbe> {
    const known = this.probed.get(agent);
    if (known) return known;
    const probe = await getDriver(agent).probe();
    if (probe.installed && !probe.problem) this.probed.set(agent, probe);
    return probe;
  }

  private async launch(
    session: HostedSession,
    resume: { agentSessionId: string; fork: boolean } | null,
  ): Promise<void> {
    const driver = getDriver(session.info.agent);
    const id = session.info.id;
    session.emit({ type: 'session', patch: { status: 'starting' } });
    try {
      const probe = await this.probe(session.info.agent);
      if (!probe.installed || probe.problem) {
        throw new Error(probe.problem ?? `${driver.label} is not installed`);
      }
      session.emit({ type: 'session', patch: { agentVersion: probe.version } });
      const stored = new Map<string, string | undefined>();
      await Promise.all(
        Object.values(CHAT_SETTING_KEYS).map(async (key) => stored.set(key, await getGlobalSetting(key))),
      );
      const settings = parseChatSettings((key) => stored.get(key));
      const sandbox = isActiveSandbox(session.row.sandbox_provider) ? session.row.sandbox_provider : undefined;
      const chosenMode = resume ? session.info.mode : undefined;
      const token = issueToken(id, sandbox ? 'sandbox' : 'host');
      const referenceEnv = await sandboxReferenceEnv(sandbox, session.row.project_path);
      session.referenceEnv = referenceEnv;
      session.driver = await driver.start({
        cwd: session.row.cwd,
        sessionId: id,
        resume,
        ...(chosenMode && { mode: chosenMode }),
        spawn: (spawn) => this.spawn(session, token, spawn),
        sink: this.sink(session),
        preferences: { piApprovals: settings.piApprovals, acpCommand: settings.acpCommand },
        instructions: readCliReference(referenceEnv.OUIJIT_SANDBOX_REFERENCE_FILE ?? getCliReferencePath()),
      });
      // For a driver that cannot launch in a mode, switch to it once started.
      if (chosenMode && session.driver.setMode && session.info.mode !== chosenMode) {
        await session.driver.setMode(chosenMode);
        session.emit({ type: 'session', patch: { mode: chosenMode } });
      }
      session.emit({
        type: 'session',
        patch: {
          capabilities: { ...session.driver.capabilities, commands: true },
          commands: withConversationCommands(session.info.commands, session.driver),
          ...(session.info.status === 'starting' && { status: 'idle' }),
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      chatLog.error('chat session failed to start', { id, agent: session.info.agent, error: detail });
      session.emit({ type: 'session', patch: { status: 'error', statusDetail: detail } });
      session.driver = null;
      revokeToken(id);
    }
  }

  private async spawn(session: HostedSession, token: string, spawn: AgentSpawn): Promise<AgentProcess> {
    const base = hostEnv();
    const env: Record<string, string> = {
      ...base,
      ...ouijitSessionEnv(session.info.id, token, base),
      ...session.referenceEnv,
    };
    for (const [key, value] of Object.entries(spawn.env ?? {})) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    const { launch, cwd } = await sandboxLaunch(
      { file: spawn.command, args: spawn.args, env },
      {
        provider: getSandboxProvider(session.row.sandbox_provider),
        projectPath: session.row.project_path,
        cwd: spawn.cwd ?? session.row.cwd,
        taskId: session.row.task_id ?? undefined,
        worktreePath: session.row.worktree_path ?? undefined,
      },
    );
    chatLog.info('spawning agent', { id: session.info.id, file: launch.file, sandbox: session.row.sandbox_provider });
    const proc = (this.options.spawnProcess ?? spawnAgentProcess)(launch.file, launch.args, cwd, launch.env);
    session.processes.add(proc);
    proc.once('exit', () => session.processes.delete(proc));
    return proc;
  }

  private sink(session: HostedSession): DriverSink {
    const id = session.info.id;
    return {
      node: (node) => session.emit({ type: 'node', node }),
      append: (nodeId, field, delta) => session.emit({ type: 'append', id: nodeId, field, delta }),
      remove: (ids) => ids.length && session.emit({ type: 'remove', ids }),
      session: (incoming) => {
        const patch =
          incoming.commands && session.driver
            ? { ...incoming, commands: withConversationCommands(incoming.commands, session.driver) }
            : incoming;
        const wasBusy = session.info.status === 'running' || session.info.status === 'awaiting';
        const next =
          patch.status === 'running' && session.asks.size > 0 ? { ...patch, status: 'awaiting' as const } : patch;
        session.emit({ type: 'session', patch: next });
        if (next.status === 'exited' || next.status === 'error') {
          for (const node of settled(session.nodes)) session.emit({ type: 'node', node });
        }
        if (wasBusy && next.status === 'idle') void this.drainQueue(session);
      },
      ask: (request) =>
        new Promise<ChatAnswer>((resolve) => {
          const node: RequestNode = { ...request, kind: 'request', status: 'pending', createdAt: Date.now() };
          session.asks.set(node.id, { resolve });
          session.emit({ type: 'node', node });
          if (session.info.status === 'running') session.emit({ type: 'session', patch: { status: 'awaiting' } });
        }),
      history: (nodes) => {
        // An agent with no record of the conversation — its session file gone —
        // is not a reason to throw away the transcript Ouijit kept.
        if (nodes.length === 0) return;
        const incoming = new Set(nodes.map((node) => node.id));
        const stale = session.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
        if (stale.length) session.emit({ type: 'remove', ids: stale });
        for (const node of nodes) session.emit({ type: 'node', node });
      },
      reset: () => {
        session.queued.splice(0);
        if (session.nodes.length) session.emit({ type: 'remove', ids: session.nodes.map((node) => node.id) });
      },
      log: (message, data) => chatLog.info(message, { id, ...data }),
    };
  }

  private broadcast(sessionId: string, event: SequencedChatEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, event);
      } catch (error) {
        chatLog.warn('chat listener threw', { error: String(error) });
      }
    }
  }

  private require(id: string): HostedSession {
    const session = this.sessions.get(id);
    if (!session) throw new ChatSessionNotFound(id);
    return session;
  }

  private async requireDriver(id: string): Promise<{ session: HostedSession; driver: DriverSession }> {
    const session = this.require(id);
    await session.starting;
    if (!session.driver) throw new Error(session.info.statusDetail ?? 'The agent is not running');
    return { session, driver: session.driver };
  }

  /**
   * Send a message. `auto` steers a running turn where the agent can, queues it
   * where it cannot, and starts a turn when the agent is idle.
   */
  async prompt(
    id: string,
    input: { text: string; attachments?: ChatAttachment[] },
    delivery: ChatDelivery = 'auto',
  ): Promise<string> {
    const { session, driver } = await this.requireDriver(id);
    const busy = session.info.status === 'running' || session.info.status === 'awaiting';
    const command = parseSlashCommand(input.text, session.info.commands);
    if (command?.kind === 'terminal') {
      throw new Error(`/${command.name} runs in the agent's terminal`);
    }
    if (command?.kind === 'conversation' && (await this.runConversationCommand(session, driver, command, busy))) {
      return '';
    }
    const node: UserMessageNode = {
      id: `user-${randomUUID()}`,
      kind: 'user_message',
      parentId: null,
      createdAt: Date.now(),
      text: input.text,
      attachments: input.attachments ?? [],
      delivery: 'prompt',
    };
    const userInput: UserInput & { id: string } = { id: node.id, text: node.text, attachments: node.attachments };
    if (!busy) {
      session.emit({ type: 'node', node });
      session.emit({ type: 'session', patch: { status: 'running' } });
      await this.run(session, () => driver.prompt(userInput));
      return node.id;
    }
    const wantsSteer = delivery === 'steer' || (delivery === 'auto' && driver.capabilities.steer);
    if (wantsSteer && driver.capabilities.steer) {
      session.emit({ type: 'node', node: { ...node, delivery: 'steer' } });
      await this.run(session, () => driver.send(userInput, 'steer'));
    } else if (driver.capabilities.queue) {
      session.emit({ type: 'node', node: { ...node, delivery: 'queued' } });
      await this.run(session, () => driver.send(userInput, 'queue'));
    } else {
      const queued = { ...node, delivery: 'queued' as const };
      session.queued.push(queued);
      session.emit({ type: 'node', node: queued });
    }
    return node.id;
  }

  /**
   * Run a conversation command through the chat's own controls, so the slash
   * command and the menu do the same thing. False when the driver leaves it
   * to the agent, as Claude does with `/clear`, which it announces as a reset.
   */
  private async runConversationCommand(
    session: HostedSession,
    driver: DriverSession,
    command: Extract<SlashCommand, { kind: 'conversation' }>,
    busy: boolean,
  ): Promise<boolean> {
    const pick = (options: ChatOption[], what: string): string => {
      const wanted = command.argument.toLowerCase();
      if (!wanted) throw new Error(`Pick a ${what} from the menu below, or type /${command.name} <${what}>`);
      const found = options.find((o) => o.id.toLowerCase() === wanted || o.label.toLowerCase() === wanted);
      if (!found) throw new Error(`No ${what} called ${command.argument}`);
      return found.id;
    };
    switch (command.action) {
      case 'clear':
        if (!driver.clear) return false;
        if (busy) throw new Error('Wait for the turn to end, or stop it, before clearing');
        await driver.clear();
        return true;
      case 'compact':
        if (!driver.compact) return false;
        await this.compact(session.info.id);
        return true;
      case 'model':
        if (!driver.setModel) return false;
        await this.setModel(session.info.id, pick(session.info.models, 'model'));
        return true;
      case 'effort':
        if (!driver.setEffort) return false;
        await this.setEffort(session.info.id, pick(session.info.efforts, 'effort'));
        return true;
    }
  }

  private async drainQueue(session: HostedSession): Promise<void> {
    const next = session.queued.shift();
    if (!next || !session.driver) return;
    const driver = session.driver;
    // Moved to the end: it is sent now, after whatever the finished turn wrote.
    session.emit({ type: 'remove', ids: [next.id] });
    session.emit({ type: 'node', node: { ...next, delivery: 'prompt', createdAt: Date.now() } });
    session.emit({ type: 'session', patch: { status: 'running' } });
    await this.run(session, () => driver.prompt({ id: next.id, text: next.text, attachments: next.attachments }));
  }

  /** A driver call failing ends the turn with the failure in the transcript rather than an exception. */
  private async run(session: HostedSession, call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      session.emit({
        type: 'node',
        node: {
          id: `notice-${randomUUID()}`,
          kind: 'notice',
          parentId: null,
          createdAt: Date.now(),
          level: 'error',
          text,
        },
      });
      if (session.info.status === 'running' || session.info.status === 'awaiting') {
        session.emit({ type: 'session', patch: { status: 'idle' } });
      }
    }
  }

  /** Answer a pending request. False when it was already answered, here or on another client. */
  answer(id: string, requestId: string, answer: ChatAnswer): boolean {
    const session = this.require(id);
    const pending = session.asks.get(requestId);
    const node = session.nodes.find((n): n is RequestNode => n.id === requestId && n.kind === 'request');
    if (!pending || !node) return false;
    session.asks.delete(requestId);
    session.emit({
      type: 'node',
      node: { ...node, status: answer.kind === 'cancel' ? 'cancelled' : 'answered', answer },
    });
    if (session.asks.size === 0 && session.info.status === 'awaiting') {
      session.emit({ type: 'session', patch: { status: 'running' } });
    }
    pending.resolve(answer);
    return true;
  }

  async interrupt(id: string): Promise<void> {
    const { session, driver } = await this.requireDriver(id);
    session.queued.splice(0).forEach((node) => session.emit({ type: 'remove', ids: [node.id] }));
    this.cancelAsks(session);
    await driver.interrupt();
  }

  async setModel(id: string, model: string): Promise<void> {
    const { session, driver } = await this.requireDriver(id);
    if (!driver.setModel) throw new Error('This agent cannot change models from chat');
    await driver.setModel(model);
    session.emit({ type: 'session', patch: { model } });
  }

  async setEffort(id: string, effort: string): Promise<void> {
    const { session, driver } = await this.requireDriver(id);
    if (!driver.setEffort) throw new Error('This agent has no reasoning effort setting');
    await driver.setEffort(effort);
    session.emit({ type: 'session', patch: { effort } });
  }

  async setMode(id: string, mode: string): Promise<void> {
    const { session, driver } = await this.requireDriver(id);
    if (!driver.setMode) throw new Error('This agent has no modes');
    await driver.setMode(mode);
    session.emit({ type: 'session', patch: { mode } });
  }

  async rewind(id: string, userMessageId: string): Promise<void> {
    const { session, driver } = await this.requireDriver(id);
    if (!driver.rewind) throw new Error('This agent cannot rewind');
    if (session.info.status !== 'idle') throw new Error('Wait for the turn to end before rewinding');
    await driver.rewind(userMessageId);
    const index = session.nodes.findIndex((node) => node.id === userMessageId);
    if (index !== -1) session.emit({ type: 'remove', ids: session.nodes.slice(index).map((node) => node.id) });
  }

  async stopBackground(id: string, taskId: string): Promise<void> {
    const { driver } = await this.requireDriver(id);
    if (!driver.stopBackground) throw new Error('This agent cannot stop background work from chat');
    await driver.stopBackground(taskId);
  }

  async compact(id: string): Promise<void> {
    const { session, driver } = await this.requireDriver(id);
    if (!driver.compact) throw new Error('This agent cannot compact from chat');
    await this.run(session, () => driver.compact!());
  }

  /**
   * Branch the conversation into a new session under a new id, which the
   * caller opens as a card of its own.
   */
  async fork(id: string): Promise<ChatSnapshot> {
    const source = this.snapshot(id);
    if (!source?.info.agentSessionId) throw new Error('Nothing to fork yet: the agent has not started a conversation');
    const row = getChatRepo().get(id);
    const snapshot = await this.start({
      agent: source.info.agent,
      projectPath: source.info.projectPath,
      cwd: source.info.cwd,
      taskId: source.info.taskId,
      worktreePath: row?.worktree_path ?? undefined,
      sandboxProvider: isSandboxProviderId(row?.sandbox_provider) ? row.sandbox_provider : undefined,
      resume: { agentSessionId: source.info.agentSessionId, fork: true },
    });
    const forked = this.require(snapshot.info.id);
    if (forked.nodes.length === 0) forked.nodes = source.nodes.map((node) => ({ ...node }));
    return forked.snapshot();
  }

  /**
   * Stop the agent and drop the session from memory, keeping its transcript.
   * Resolves once the agent has exited, so the same conversation can be
   * resumed elsewhere — the card's terminal — without two processes writing it.
   */
  /**
   * Stop the agent and drop the session from memory, keeping its transcript.
   * The agent takes a moment to go, and a start asked for meanwhile waits for it.
   */
  stop(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return Promise.resolve();
    session.stopping ??= this.shutDown(session);
    return session.stopping;
  }

  private async shutDown(session: HostedSession): Promise<void> {
    const id = session.info.id;
    await session.starting;
    this.cancelAsks(session);
    const driver = session.driver;
    session.driver = null;
    try {
      await driver?.close();
    } catch (error) {
      chatLog.warn('agent did not close cleanly', { id, error: String(error) });
    }
    for (const node of settled(session.nodes)) session.emit({ type: 'node', node });
    session.emit({ type: 'session', patch: { status: 'exited' } });
    session.flush();
    this.sessions.delete(id);
    revokeToken(id);
  }

  async discard(id: string): Promise<void> {
    await this.stop(id);
    getChatRepo().delete(id);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }

  /** App-quit: no time to wait for a graceful close. */
  killAll(): void {
    for (const session of this.sessions.values()) {
      session.flush();
      for (const proc of session.processes) proc.kill('SIGTERM');
      revokeToken(session.info.id);
    }
    this.sessions.clear();
  }

  private cancelAsks(session: HostedSession): void {
    for (const requestId of [...session.asks.keys()]) this.answer(session.info.id, requestId, { kind: 'cancel' });
  }
}

function storedSnapshot(row: ChatSessionRow): ChatSnapshot {
  const info = JSON.parse(row.info) as ChatSessionInfo;
  return {
    info: { ...info, agentSessionId: row.agent_session_id },
    nodes: getChatRepo()
      .nodes(row.id)
      .map((body) => JSON.parse(body) as ChatNode),
    seq: row.seq,
  };
}

export const chatHost = new ChatHost();
