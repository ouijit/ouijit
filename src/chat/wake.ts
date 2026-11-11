import { getLogger } from '../logger';
import { getAllProjects, getTaskByNumber } from '../db';
import { taskEvents, type TaskStatusChange } from '../taskEvents';
import { getSessionSpawnContext } from '../sessions';
import { chatHost } from './host';
import { homeChatCurrent, loadHomeChatSettings } from './homeChat';
import { isHomeChatId, type WakeEvent } from './preferences';
import type { ChatSessionInfo, ChatSessionStatus, RequestNode } from './model';

const wakeLog = getLogger().scope('chat:wake');

const COLUMNS: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

/** A session or task as Chat is told about it: the task's name, number and project. */
export async function describeTask(projectPath: string, taskNumber: number): Promise<string> {
  const [task, projects] = await Promise.all([getTaskByNumber(projectPath, taskNumber), getAllProjects()]);
  const project = projects.find((p) => p.path === projectPath)?.name ?? projectPath;
  return `${task?.name ?? `Task ${taskNumber}`} (T-${taskNumber} in ${project})`;
}

export async function describeSession(info: ChatSessionInfo): Promise<string> {
  const who = info.taskId != null ? await describeTask(info.projectPath, info.taskId) : (info.label ?? info.id);
  return `${who}, chat ${info.id},`;
}

/**
 * A message to Chat about something that happened, when its settings ask for
 * that kind. Nothing is sent to a Chat that is not running: a wake is about
 * now, and is stale by the time it would be read.
 */
export async function wakeHomeChat(event: WakeEvent | null, text: string): Promise<void> {
  if (event && !(await loadHomeChatSettings()).wake[event]) return;
  const id = homeChatCurrent();
  const home = id ? chatHost.snapshot(id) : null;
  if (!id || !chatHost.isLive(id) || !home || home.info.status === 'error' || home.info.status === 'exited') return;
  try {
    await chatHost.prompt(id, { text: `Ouijit: ${text}`, wake: true }, 'queue');
  } catch (error) {
    wakeLog.warn('wake not delivered', { event, error: String(error) });
  }
}

function busy(status: ChatSessionStatus | undefined): boolean {
  return status === 'running' || status === 'awaiting';
}

/** A worker that has asked the user to run something outside its sandbox is stuck until they do. */
export async function wakeForAsk(ptyId: string, command: string, message: string): Promise<void> {
  const info = chatHost.snapshot(ptyId)?.info;
  const context = getSessionSpawnContext(ptyId);
  const who = info
    ? await describeSession(info)
    : context?.taskId != null
      ? `${await describeTask(context.projectPath, context.taskId)},`
      : `Terminal ${ptyId},`;
  const why = message ? ` (${message})` : '';
  await wakeHomeChat(
    'asked',
    `${who} is waiting on the user to run \`${command}\` outside its sandbox${why}. Only the user can run it.`,
  );
}

/** Follow every other chat and every task for what Chat should hear about. Once per process. */
export function installHomeChatWakes(): void {
  const lastStatus = new Map<string, ChatSessionStatus>();
  chatHost.subscribe((sessionId, { event }) => {
    if (isHomeChatId(sessionId)) return;
    const info = chatHost.snapshot(sessionId)?.info;
    if (!info) return;
    if (event.type === 'session' && event.patch.status) {
      const before = lastStatus.get(sessionId);
      lastStatus.set(sessionId, event.patch.status);
      if (busy(before) && event.patch.status === 'idle') {
        void describeSession(info).then((who) => wakeHomeChat('turnEnded', `${who} finished its turn.`));
      }
      return;
    }
    if (event.type === 'node' && event.node.kind === 'request' && event.node.status === 'pending') {
      const request = event.node as RequestNode;
      void describeSession(info).then((who) =>
        wakeHomeChat('asked', `${who} is waiting on an approval: ${request.title} (request ${request.id}).`),
      );
    }
  });
  taskEvents.on('status', (change: TaskStatusChange) => {
    void describeTask(change.projectPath, change.taskNumber).then((who) =>
      wakeHomeChat(
        'taskMoved',
        `${who} moved from ${COLUMNS[change.from] ?? change.from} to ${COLUMNS[change.to] ?? change.to}.`,
      ),
    );
  });
}
