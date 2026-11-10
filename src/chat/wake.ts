import { getLogger } from '../logger';
import { getAllProjects, getTaskByNumber } from '../db';
import { taskEvents, type TaskStatusChange } from '../taskEvents';
import { chatHost } from './host';
import { loadHomeChatSettings } from './homeChat';
import { HOME_CHAT_ID, type WakeEvent } from './preferences';
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
  const home = chatHost.snapshot(HOME_CHAT_ID);
  if (!chatHost.isLive(HOME_CHAT_ID) || !home || home.info.status === 'error' || home.info.status === 'exited') return;
  try {
    await chatHost.prompt(HOME_CHAT_ID, { text: `Ouijit: ${text}`, wake: true }, 'queue');
  } catch (error) {
    wakeLog.warn('wake not delivered', { event, error: String(error) });
  }
}

function busy(status: ChatSessionStatus | undefined): boolean {
  return status === 'running' || status === 'awaiting';
}

/** Follow every other chat and every task for what Chat should hear about. Once per process. */
export function installHomeChatWakes(): void {
  const lastStatus = new Map<string, ChatSessionStatus>();
  chatHost.subscribe((sessionId, { event }) => {
    if (sessionId === HOME_CHAT_ID) return;
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
