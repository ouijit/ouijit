import type { DriverSession } from '../agents';
import type { ChatCommand, ChatOption, SlashCommand } from './model';
import type { HostedSession } from './hostedSession';
import { runTurn } from './promptDelivery';

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

export function withConversationCommands(commands: ChatCommand[], driver: DriverSession): ChatCommand[] {
  const own = conversationCommands(driver).filter((command) => !commands.some((c) => c.name === command.name));
  return [...own, ...commands];
}

/**
 * Run a conversation command through the chat's own controls, so the slash
 * command and the menu do the same thing. False when the driver leaves it
 * to the agent, as Claude does with `/clear`, which it announces as a reset.
 */
export async function runConversationCommand(
  session: HostedSession,
  driver: DriverSession,
  command: Extract<SlashCommand, { kind: 'conversation' }>,
  busy: boolean,
  onClear: ((id: string) => Promise<boolean>) | undefined,
): Promise<boolean> {
  const pick = (options: ChatOption[], what: string): string => {
    const wanted = command.argument.toLowerCase();
    if (!wanted) throw new Error(`Name a ${what}: /${command.name} <${what}>`);
    const found = options.find((o) => o.id.toLowerCase() === wanted || o.label.toLowerCase() === wanted);
    if (!found) throw new Error(`No ${what} called ${command.argument}`);
    return found.id;
  };
  switch (command.action) {
    case 'clear':
      if (await onClear?.(session.info.id)) return true;
      if (!driver.clear) return false;
      if (busy) throw new Error('Wait for the turn to end, or stop it, before clearing');
      await driver.clear();
      return true;
    case 'compact':
      if (!driver.compact) return false;
      await compact(session);
      return true;
    case 'model':
      if (!driver.setModel) return false;
      await setModel(session, pick(session.info.models, 'model'));
      return true;
    case 'effort':
      if (!driver.setEffort) return false;
      await setEffort(session, pick(session.info.efforts, 'effort'));
      return true;
  }
}

export async function interrupt(session: HostedSession): Promise<void> {
  // Said before anything is awaited, so whoever pressed stop sees it taken at once.
  if (session.info.status === 'running' || session.info.status === 'awaiting') {
    session.emit({ type: 'session', patch: { stopping: true } });
  }
  try {
    const driver = await session.readyDriver();
    session.queued.splice(0).forEach((node) => session.emit({ type: 'remove', ids: [node.id] }));
    session.cancelAsks();
    await driver.interrupt();
  } catch (error) {
    if (session.info.stopping) session.emit({ type: 'session', patch: { stopping: false } });
    throw error;
  }
}

export async function setModel(session: HostedSession, model: string): Promise<void> {
  const driver = await session.readyDriver();
  if (!driver.setModel) throw new Error('This agent cannot change models from chat');
  await driver.setModel(model);
  session.emit({ type: 'session', patch: { model } });
}

export async function setEffort(session: HostedSession, effort: string): Promise<void> {
  const driver = await session.readyDriver();
  if (!driver.setEffort) throw new Error('This agent has no reasoning effort setting');
  await driver.setEffort(effort);
  session.emit({ type: 'session', patch: { effort } });
}

/**
 * A looser mode takes effect at once where the agent can change modes
 * mid-turn, so its approvals stop without stopping the turn. A stricter one,
 * or any on an agent that cannot, waits for the turn to end.
 */
export async function setMode(session: HostedSession, mode: string): Promise<void> {
  const driver = await session.readyDriver();
  if (!driver.setMode) throw new Error('This agent has no modes');
  const latitude = (of: string | undefined) => session.info.modes.find((option) => option.id === of)?.latitude;
  const [from, to] = [latitude(session.info.mode), latitude(mode)];
  const looser = !!driver.modeMidTurn && from !== undefined && to !== undefined && to > from;
  if ((session.info.status === 'running' || session.info.status === 'awaiting') && !looser) {
    session.emit({ type: 'session', patch: { pendingMode: mode === session.info.mode ? null : mode } });
    return;
  }
  await driver.setMode(mode);
  session.emit({ type: 'session', patch: { mode, pendingMode: null } });
}

export async function rewind(session: HostedSession, userMessageId: string): Promise<void> {
  const driver = await session.readyDriver();
  if (!driver.rewind) throw new Error('This agent cannot rewind');
  if (session.info.status !== 'idle') throw new Error('Wait for the turn to end before rewinding');
  await driver.rewind(userMessageId);
  const index = session.nodes.findIndex((node) => node.id === userMessageId);
  if (index !== -1) session.emit({ type: 'remove', ids: session.nodes.slice(index).map((node) => node.id) });
}

export async function stopBackground(session: HostedSession, taskId: string): Promise<void> {
  const driver = await session.readyDriver();
  if (!driver.stopBackground) throw new Error('This agent cannot stop background work from chat');
  await driver.stopBackground(taskId);
}

/** Null where the agent does not share it. */
export async function backgroundOutput(session: HostedSession, taskId: string): Promise<string | null> {
  const driver = await session.readyDriver();
  return driver.backgroundOutput ? driver.backgroundOutput(taskId) : null;
}

export async function compact(session: HostedSession): Promise<void> {
  // Said before anything is awaited: some agents report nothing until the compaction is done.
  if (session.info.status === 'idle') {
    session.emit({ type: 'session', patch: { status: 'running', compacting: Date.now() } });
  }
  try {
    const driver = await session.readyDriver();
    if (!driver.compact) throw new Error('This agent cannot compact from chat');
    await runTurn(session, () => driver.compact!());
  } catch (error) {
    if (session.info.compacting) session.emit({ type: 'session', patch: { status: 'idle', compacting: null } });
    throw error;
  }
}
