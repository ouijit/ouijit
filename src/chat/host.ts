import { randomUUID } from 'node:crypto';
import { getChatRepo } from '../db';
import { reconfigured, relabel, storedInfo, storedNodes, storedRow, storedSnapshot } from './sessionStore';
import { revokeToken } from '../apiAuth';
import { isActiveSandbox, isSandboxProviderId } from '../sandbox/types';
import { spawnAgentProcess, type DriverProbe, type DriverSession } from '../agents';
import { generateTitle, titlePrompt } from './title';
import { getDriver } from './drivers';
import type { ChatDelivery, ChatStartOptions } from './startOptions';
import {
  NO_CAPABILITIES,
  isChatAgentId,
  parseSlashCommand,
  type ChatAgentId,
  type ChatAnswer,
  type ChatRole,
  type ChatSessionInfo,
  type ChatSnapshot,
  type SequencedChatEvent,
  type UserMessageNode,
  type WakeNote,
  type TaskChatSummary,
} from './model';
import { chatLog, settled, HostedSession, type ChatListener } from './hostedSession';
import { launch, spawnAgent } from './sessionLaunch';
import { deliverPrompt, type PromptInput } from './promptDelivery';
import * as commands from './conversationCommands';

export type { ChatListener } from './hostedSession';

export class ChatSessionNotFound extends Error {
  constructor(id: string) {
    super(`Chat session ${id} not found`);
  }
}

export interface ChatHostOptions {
  spawnProcess?: typeof spawnAgentProcess;
  /**
   * Runs the agent's one-shots, such as a title. With only `spawnProcess` set
   * there are none: its stand-in agent has nothing recorded for them.
   */
  spawnOneShot?: typeof spawnAgentProcess;
  /** Takes `/clear` for a session instead of the driver; true when it did. */
  onClear?: (id: string) => Promise<boolean>;
}

export class ChatHost {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly listeners = new Set<ChatListener>();
  private readonly probed = new Map<ChatAgentId, DriverProbe>();

  constructor(private options: ChatHostOptions = {}) {}

  /** Tests and e2e runs only: put a recorded agent behind the app's own host. */
  _setOptionsForTesting(options: ChatHostOptions): void {
    this.options = { ...this.options, ...options };
  }

  /** What `/clear` does in a session, over the driver's own clear. */
  set onClear(hook: ChatHostOptions['onClear']) {
    this.options = { ...this.options, onClear: hook };
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
    const row = storedRow(id);
    return row ? storedSnapshot(row) : null;
  }

  /** Write a live session's pending changes now rather than on the next timer. */
  flush(id: string): void {
    this.sessions.get(id)?.flush();
  }

  /** Read off the stored row for a session that is not running, so a role outlives its process. */
  roleOf(id: string): ChatRole | null {
    return this.sessions.get(id)?.info.role ?? storedRow(id)?.role ?? null;
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

  /** A project's task chats, by the first thing the user asked in each; one with nothing asked yet is left out. */
  taskChats(projectPath: string): TaskChatSummary[] {
    return getChatRepo()
      .listTaskChats(projectPath)
      .flatMap((row) => {
        const asked = this.snapshot(row.id)?.nodes.find(
          (node): node is UserMessageNode => node.kind === 'user_message' && !node.wake,
        );
        if (!asked || row.task_id === null || !isChatAgentId(row.agent)) return [];
        return [
          {
            id: row.id,
            taskId: row.task_id,
            agent: row.agent,
            sandbox: row.sandbox_provider,
            firstMessage: asked.text,
            updatedAt: row.updated_at,
          },
        ];
      });
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

    let stored = storedRow(id);
    const role = stored?.role ?? options.role ?? 'card';
    if ((options.role ?? 'card') !== role) throw new Error(`Session ${id} already exists in another role`);
    if (stored && options.reconfigure) stored = reconfigured(stored, options);
    const agent = stored && isChatAgentId(stored.agent) ? stored.agent : options.agent;
    const sandboxProvider = stored
      ? isSandboxProviderId(stored.sandbox_provider)
        ? stored.sandbox_provider
        : undefined
      : options.sandboxProvider;
    const base: ChatSessionInfo = stored
      ? storedInfo(stored)
      : {
          id,
          role,
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
    if (stored) session.nodes = storedNodes(id);
    session.seq = stored?.seq ?? 0;
    session.instructions = options.instructions ?? '';
    session.launchMode = options.mode ?? this.ownersMode(options);
    for (const node of settled(session.nodes)) session.emit({ type: 'node', node });
    this.sessions.set(id, session);

    const resume =
      options.resume ?? (base.agentSessionId ? { agentSessionId: base.agentSessionId, fork: false } : null);
    if (options.resume)
      session.info = { ...session.info, agentSessionId: options.resume.fork ? null : options.resume.agentSessionId };
    session.starting = launch(session, resume, {
      probe: (agent) => this.probe(agent),
      spawn: (token, spawn) => spawnAgent(session, token, spawn, this.options.spawnProcess ?? spawnAgentProcess),
    });
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

  /**
   * A short title for a conversation that opens with `message`, from a one-shot
   * of its agent in the session's own sandbox. Null where the agent has no
   * one-shot, or it fails.
   */
  async suggestTitle(id: string, message: string): Promise<string | null> {
    const session = this.sessions.get(id);
    const run = this.options.spawnOneShot ?? (this.options.spawnProcess ? null : spawnAgentProcess);
    const oneShot = session && run && getDriver(session.info.agent).oneShot?.(titlePrompt(message));
    if (!session || !run || !oneShot) return null;
    // Without the session's Ouijit token: a one-shot has no business with the API.
    return generateTitle((spawn) => spawnAgent(session, null, spawn, run), oneShot);
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
    return { session, driver: await session.readyDriver() };
  }

  async prompt(id: string, input: PromptInput, delivery: ChatDelivery = 'auto'): Promise<string> {
    const { session, driver } = await this.requireDriver(id);
    const busy = session.info.status === 'running' || session.info.status === 'awaiting';
    const command = parseSlashCommand(input.text, session.info.commands, session.info.agent);
    if (command?.kind === 'terminal') {
      throw new Error(`/${command.name} runs in the agent's terminal`);
    }
    if (
      command?.kind === 'conversation' &&
      (await commands.runConversationCommand(session, driver, command, busy, this.options.onClear))
    ) {
      return '';
    }
    return deliverPrompt(session, driver, input, delivery, busy);
  }

  /** Answer a pending request. False when it was already answered, here or on another client. */
  answer(id: string, requestId: string, answer: ChatAnswer, { byChat = false } = {}): boolean {
    return this.require(id).answer(requestId, answer, { byChat });
  }

  /** A task Chat owns starts in Chat's mode. Modes are the agent's own, so only a worker on Chat's agent takes it. */
  private ownersMode(options: ChatStartOptions): string | undefined {
    if (options.taskId == null) return undefined;
    const repo = getChatRepo();
    const owner = repo.taskOwner(options.projectPath, options.taskId);
    if (!owner) return undefined;
    const live = this.sessions.get(owner)?.info;
    const row = live ? undefined : repo.get(owner);
    const chat = live ?? (row ? (JSON.parse(row.info) as ChatSessionInfo) : undefined);
    return chat?.agent === options.agent ? chat.mode : undefined;
  }

  /** Rewrite the notes of every wake a live Chat conversation holds. */
  reviseWakeNotes(revise: (note: WakeNote) => WakeNote): void {
    for (const session of this.sessions.values()) {
      if (session.info.role !== 'home') continue;
      for (const node of session.nodes) {
        if (node.kind !== 'user_message' || !node.notes) continue;
        const notes = node.notes.map(revise);
        if (notes.some((note, index) => note !== node.notes![index]))
          session.emit({ type: 'node', node: { ...node, notes } });
      }
    }
  }

  async interrupt(id: string): Promise<void> {
    await commands.interrupt(this.require(id));
  }

  /** Name a session, live or stored. False when there is no such session. */
  setLabel(id: string, label: string): boolean {
    const live = this.sessions.get(id);
    if (live) {
      live.emit({ type: 'session', patch: { label } });
      return true;
    }
    const row = storedRow(id);
    if (!row) return false;
    relabel(row, label);
    return true;
  }

  async setModel(id: string, model: string): Promise<void> {
    await commands.setModel(this.require(id), model);
  }

  async setEffort(id: string, effort: string): Promise<void> {
    await commands.setEffort(this.require(id), effort);
  }

  async setMode(id: string, mode: string): Promise<void> {
    await commands.setMode(this.require(id), mode);
  }

  async rewind(id: string, userMessageId: string): Promise<void> {
    await commands.rewind(this.require(id), userMessageId);
  }

  async stopBackground(id: string, taskId: string): Promise<void> {
    await commands.stopBackground(this.require(id), taskId);
  }

  async backgroundOutput(id: string, taskId: string): Promise<string | null> {
    return commands.backgroundOutput(this.require(id), taskId);
  }

  async compact(id: string): Promise<void> {
    await commands.compact(this.require(id));
  }

  /**
   * Branch the conversation into a new session under a new id, which the
   * caller opens as a card of its own.
   */
  async fork(id: string): Promise<ChatSnapshot> {
    const source = this.snapshot(id);
    if (!source?.info.agentSessionId) throw new Error('Nothing to fork yet: the agent has not started a conversation');
    const row = storedRow(id);
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
    session.cancelAsks();
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
}

export const chatHost = new ChatHost();
