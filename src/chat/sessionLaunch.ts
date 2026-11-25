import { getAllProjects, getGlobalSetting } from '../db';
import { getWorktreesRoot } from '../worktree';
import { CHAT_SETTING_KEYS, parseChatSettings } from './preferences';
import { issueToken, revokeToken } from '../apiAuth';
import { hostEnv, ouijitSessionEnv, sandboxLaunch } from '../sessionEnv';
import { sandboxCliAccessFor, sandboxReferenceEnv } from '../sandbox/cliAccess';
import { getCliReferencePath, readCliReference } from '../cliReferencePath';
import type { AgentProcess, AgentSpawn, DriverProbe, DriverSink, spawnAgentProcess } from '../agents';
import { getDriver } from './drivers';
import type {
  ChatAgentId,
  ChatAnswer,
  ChatNode,
  ReasoningNode,
  RequestNode,
  ToolCallNode,
  UserMessageNode,
} from './model';
import { chatLog, settled, type HostedSession } from './hostedSession';
import { endTurn } from './promptDelivery';
import { withConversationCommands } from './conversationCommands';

const CHAT_SURFACE = `You are talking with the user in Ouijit Chat, which renders your replies as Markdown. To show the user an image, such as a screenshot or a diagram you made, put it in your reply as a Markdown image with an absolute path: ![what it shows](/absolute/path/to/image.png). An image you only read with a tool is seen by you, not by the user.`;

// Stands over the reference's "From a sandbox" section, which is written for a card.
const CHAT_READ_ONLY = `As Chat at View, you reach every project rather than one: every command that reads or lists works, as do following and unfollowing, your own tags and panels, drafts, and ouijit ask. Commands that move a task or message, answer or interrupt an agent are Forbidden; ask the user to raise Ouijit CLI access to Whole board in Chat's settings. Even then, tasks you start run in your sandbox, and you steer only the agents running in it.`;

export interface LaunchContext {
  probe: (agent: ChatAgentId) => Promise<DriverProbe>;
  spawn: (token: string, spawn: AgentSpawn) => Promise<AgentProcess>;
}

export async function launch(
  session: HostedSession,
  resume: { agentSessionId: string; fork: boolean } | null,
  context: LaunchContext,
): Promise<void> {
  const driver = getDriver(session.info.agent);
  const id = session.info.id;
  session.emit({ type: 'session', patch: { status: 'starting' } });
  try {
    const probe = await context.probe(session.info.agent);
    if (!probe.installed || probe.problem) {
      throw new Error(probe.problem ?? `${driver.label} is not installed`);
    }
    session.emit({ type: 'session', patch: { agentVersion: probe.version } });
    const stored = new Map<string, string | undefined>();
    await Promise.all(
      Object.values(CHAT_SETTING_KEYS).map(async (key) => stored.set(key, await getGlobalSetting(key))),
    );
    const settings = parseChatSettings((key) => stored.get(key));
    const sandbox = session.row.sandbox;
    const chosenMode = session.launchMode ?? (resume ? (session.info.pendingMode ?? session.info.mode) : undefined);
    const token = issueToken(id, sandbox ? 'sandbox' : 'host');
    const referenceEnv = await sandboxReferenceEnv(sandbox);
    session.referenceEnv = referenceEnv;
    const reference = readCliReference(referenceEnv.OUIJIT_SANDBOX_REFERENCE_FILE ?? getCliReferencePath());
    const readOnlyChat =
      sandbox && session.info.role === 'home' && (await sandboxCliAccessFor(sandbox.settings)) === 'read';
    session.driver = await driver.start({
      cwd: session.row.cwd,
      sessionId: id,
      resume,
      ...(chosenMode && { mode: chosenMode }),
      spawn: (spawn) => context.spawn(token, spawn),
      sink: driverSink(session),
      preferences: { piApprovals: settings.piApprovals, acpCommand: settings.acpCommand },
      instructions: [reference, readOnlyChat && CHAT_READ_ONLY, CHAT_SURFACE, session.instructions]
        .filter(Boolean)
        .join('\n\n'),
    });
    // For a driver that cannot launch in a mode, switch to it once started.
    if (chosenMode && session.driver.setMode && session.info.mode !== chosenMode) {
      await session.driver.setMode(chosenMode);
    }
    if (chosenMode) session.emit({ type: 'session', patch: { mode: chosenMode, pendingMode: null } });
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

/** Chat reads every project and every task's worktree to answer about them; it changes them only through tasks. */
async function chatReadPaths(): Promise<string[]> {
  const projects = await getAllProjects();
  return [...projects.map((project) => project.path), getWorktreesRoot()];
}

export async function spawnAgent(
  session: HostedSession,
  token: string | null,
  spawn: AgentSpawn,
  run: typeof spawnAgentProcess,
): Promise<AgentProcess> {
  const base = hostEnv();
  const env: Record<string, string> = {
    ...base,
    ...(token && { ...ouijitSessionEnv(session.info.id, token, base), ...session.referenceEnv }),
  };
  for (const [key, value] of Object.entries(spawn.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const { launch, cwd } = await sandboxLaunch(
    { file: spawn.command, args: spawn.args, env },
    {
      sandbox: session.row.sandbox,
      projectPath: session.row.project_path,
      cwd: spawn.cwd ?? session.row.cwd,
      taskId: session.row.task_id ?? undefined,
      worktreePath: session.row.worktree_path ?? undefined,
      ...(session.info.role === 'home' && { readPaths: await chatReadPaths() }),
    },
  );
  chatLog.info('spawning agent', { id: session.info.id, file: launch.file, sandbox: session.row.sandbox });
  const proc = run(launch.file, launch.args, cwd, launch.env);
  session.processes.add(proc);
  proc.once('exit', () => session.processes.delete(proc));
  return proc;
}

function driverSink(session: HostedSession): DriverSink {
  const id = session.info.id;
  const sink: DriverSink = {
    node: (node) => {
      session.emit({ type: 'node', node: restamped(session.nodes, node) });
      // Pi reports nothing more once a compaction is done, so its landing ends the wait.
      if (node.kind === 'compaction' && session.info.compacting) sink.session({ status: 'idle' });
    },
    append: (nodeId, field, delta) => session.emit({ type: 'append', id: nodeId, field, delta }),
    remove: (ids) => ids.length && session.emit({ type: 'remove', ids }),
    session: (incoming) => {
      const patch =
        incoming.commands && session.driver
          ? { ...incoming, commands: withConversationCommands(incoming.commands, session.driver) }
          : incoming;
      const wasBusy = session.info.status === 'running' || session.info.status === 'awaiting';
      const awaited =
        patch.status === 'running' && session.asks.size > 0 ? { ...patch, status: 'awaiting' as const } : patch;
      const ended = awaited.status !== undefined && awaited.status !== 'running' && awaited.status !== 'awaiting';
      const next = ended
        ? {
            ...awaited,
            ...(session.info.stopping && { stopping: false }),
            ...(session.info.compacting && { compacting: null }),
          }
        : awaited;
      session.emit({ type: 'session', patch: next });
      if (next.status === 'exited' || next.status === 'error') {
        for (const node of settled(session.nodes)) session.emit({ type: 'node', node });
      }
      if (wasBusy && next.status === 'idle') void endTurn(session);
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
      // A record that opens with a compaction has dropped what came before
      // it; that part of the transcript is kept rather than read as stale.
      const overlap = session.nodes.findIndex((node) => incoming.has(node.id));
      const start = nodes[0]?.kind === 'compaction' ? (overlap === -1 ? session.nodes.length : overlap) : 0;
      const covered = session.nodes.slice(start);
      const merged = mergedHistory(covered, nodes);
      const kept = new Set(merged.map((node) => node.id));
      const stale = covered.filter((node) => !kept.has(node.id)).map((node) => node.id);
      if (stale.length) session.emit({ type: 'remove', ids: stale });
      // A node event updates a node in place or appends it, so whatever is
      // out of the record's order is taken out and appended again.
      const remaining = covered.filter((node) => kept.has(node.id));
      let inOrder = 0;
      while (inOrder < remaining.length && remaining[inOrder].id === merged[inOrder].id) inOrder++;
      const moved = remaining.slice(inOrder).map((node) => node.id);
      if (moved.length) session.emit({ type: 'remove', ids: moved });
      for (const node of merged) session.emit({ type: 'node', node });
    },
    reset: () => {
      session.queued.splice(0);
      if (session.nodes.length) session.emit({ type: 'remove', ids: session.nodes.map((node) => node.id) });
    },
    log: (message, data) => chatLog.info(message, { id, ...data }),
  };
  return sink;
}

/**
 * A node a driver sends again keeps when it first appeared, since drivers
 * stamp every send; a thought or a step gets when it finished, for its duration.
 */
function restamped(nodes: ChatNode[], node: ChatNode): ChatNode {
  const before = nodes.find((other) => other.id === node.id);
  if (!before) return node;
  const timed = (n: ChatNode): n is ReasoningNode | ToolCallNode => n.kind === 'reasoning' || n.kind === 'tool_call';
  const going = (n: ReasoningNode | ToolCallNode) => n.status === 'running' || n.status === 'pending';
  if (timed(node) && timed(before) && !going(node)) {
    const endedAt = going(before) ? Date.now() : before.endedAt;
    return { ...node, createdAt: before.createdAt, ...(endedAt !== undefined && { endedAt }) };
  }
  return { ...node, createdAt: before.createdAt };
}

/** Made by Ouijit as they happen, so no agent's record of the conversation holds them. */
const OUIJIT_KINDS = new Set<ChatNode['kind']>(['notice', 'request']);

/**
 * The transcript an agent's record of the conversation gives, in the record's
 * order and under its ids. An agent that numbers messages itself names the
 * user's messages and its compactions differently from how they were shown
 * live, so those are matched in order instead; a match keeps when it happened
 * and what only Ouijit knew about it. Ouijit's own nodes, and a compaction
 * already shown, stay after the node they followed: a record puts a compaction
 * where its summary sits in the context, ahead of what it kept verbatim.
 */
function mergedHistory(stored: ChatNode[], record: ChatNode[]): ChatNode[] {
  const ids = new Set(record.map((node) => node.id));
  const byId = new Map(stored.map((node) => [node.id, node]));
  const unmatched = stored.filter(
    (node) => !ids.has(node.id) && (node.kind === 'user_message' || node.kind === 'compaction'),
  );
  const matchedAt = new Map<string, number>();
  const merged = record.map((node, index) => {
    let before = byId.get(node.id);
    if (!before && (node.kind === 'user_message' || node.kind === 'compaction')) {
      const at = unmatched.findIndex(
        (other) =>
          other.kind === node.kind && (node.kind !== 'user_message' || (other as UserMessageNode).text === node.text),
      );
      if (at !== -1) before = unmatched.splice(at, 1)[0];
    }
    if (!before) return node;
    matchedAt.set(before.id, index);
    return carried(before, node);
  });
  const following = new Map<number, ChatNode[]>();
  const follow = (after: number, node: ChatNode) => following.set(after, [...(following.get(after) ?? []), node]);
  const placed = new Set<number>();
  let last = -1;
  stored.forEach((node, at) => {
    const index = matchedAt.get(node.id);
    const previous = at > 0 ? matchedAt.get(stored[at - 1].id) : -1;
    if (index !== undefined && node.kind === 'compaction' && previous !== undefined) {
      placed.add(index);
      follow(previous, merged[index]);
    } else if (index !== undefined) last = index;
    else if (OUIJIT_KINDS.has(node.kind) && !ids.has(node.id)) follow(last, node);
  });
  return [
    ...(following.get(-1) ?? []),
    ...merged.flatMap((node, index) => [...(placed.has(index) ? [] : [node]), ...(following.get(index) ?? [])]),
  ];
}

function carried(before: ChatNode, node: ChatNode): ChatNode {
  if (node.kind === 'user_message' && before.kind === 'user_message') {
    return {
      ...node,
      createdAt: before.createdAt,
      attachments: node.attachments.length ? node.attachments : before.attachments,
      ...(before.wake && { wake: true }),
      ...(before.notes && { notes: before.notes }),
    };
  }
  if (node.kind === 'reasoning' && before.kind === 'reasoning' && before.endedAt !== undefined) {
    return { ...node, createdAt: before.createdAt, endedAt: node.endedAt ?? before.endedAt };
  }
  return { ...node, createdAt: before.createdAt };
}
