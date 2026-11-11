import { getLogger } from '../logger';
import { getAllProjects, getTaskByNumber } from '../db';
import { taskEvents, type TaskStatusChange } from '../taskEvents';
import { getSessionSpawnContext, getSessionTaskContext } from '../sessions';
import { chatHost } from './host';
import { Mailbox } from './mailbox';
import { homeChatCurrent, loadHomeChatSettings, taskOwner } from './homeChat';
import type { TaskRef, WakeEvent } from './preferences';
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

/** What a session works on, so news of it goes to the conversation that started the task. */
export function sessionTask(id: string): TaskRef | null {
  const context = getSessionTaskContext(id);
  return context ? { projectPath: context.projectPath, taskNumber: context.taskId } : null;
}

const mailbox = new Mailbox({
  exists: (id) => chatHost.roleOf(id) !== null,
  ready: (id) => chatHost.isLive(id) && chatHost.snapshot(id)?.info.status === 'idle',
  send: async (id, text) => {
    try {
      await chatHost.prompt(id, { text, wake: true });
    } catch (error) {
      wakeLog.warn('wake not delivered', { id, error: String(error) });
    }
  },
});

/**
 * Tell Chat something that happened, when its settings ask for that kind.
 * News of a task goes to the conversation that started it, anything else to
 * the one open.
 */
export async function wakeHomeChat(event: WakeEvent | null, text: string, about?: TaskRef | null): Promise<void> {
  if (event && !(await loadHomeChatSettings()).wake[event]) return;
  const to = (about && taskOwner(about.projectPath, about.taskNumber)) ?? homeChatCurrent();
  if (to) await mailbox.post(to, text);
}

/** Straight to one conversation, whatever the settings: the answer to something it asked. */
export function tellConversation(id: string, text: string): Promise<void> {
  return mailbox.post(id, text);
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
    sessionTask(ptyId),
  );
}

/** Follow every other chat and every task for what Chat should hear about. Once per process. */
export function installHomeChatWakes(): void {
  const lastStatus = new Map<string, ChatSessionStatus>();
  chatHost.subscribe((sessionId, { event }) => {
    const info = chatHost.snapshot(sessionId)?.info;
    if (!info) return;
    if (info.role === 'home') {
      if (event.type === 'session' && event.patch.status === 'idle') void mailbox.deliver(sessionId);
      return;
    }
    if (event.type === 'session' && event.patch.status) {
      const before = lastStatus.get(sessionId);
      lastStatus.set(sessionId, event.patch.status);
      if (busy(before) && event.patch.status === 'idle') {
        void describeSession(info).then((who) =>
          wakeHomeChat('turnEnded', `${who} finished its turn.`, sessionTask(sessionId)),
        );
      }
      return;
    }
    if (event.type === 'node' && event.node.kind === 'request' && event.node.status === 'pending') {
      const request = event.node as RequestNode;
      void describeSession(info).then((who) =>
        wakeHomeChat(
          'asked',
          `${who} is waiting on an approval: ${request.title} (request ${request.id}).`,
          sessionTask(sessionId),
        ),
      );
    }
  });
  taskEvents.on('status', (change: TaskStatusChange) => {
    void describeTask(change.projectPath, change.taskNumber).then((who) =>
      wakeHomeChat(
        'taskMoved',
        `${who} moved from ${COLUMNS[change.from] ?? change.from} to ${COLUMNS[change.to] ?? change.to}.`,
        change,
      ),
    );
  });
}
