import * as path from 'node:path';
import { getLogger } from '../logger';
import { getTaskByNumber } from '../db';
import { taskEvents, type TaskStatusChange } from '../taskEvents';
import { getSessionSpawnContext, getSessionTaskContext } from '../sessions';
import { chatHost } from './host';
import { Mailbox } from './mailbox';
import { homeChatCurrent, loadHomeChatSettings, taskOwner } from './homeChat';
import type { TaskRef, WakeEvent } from './preferences';
import type { ChatSessionInfo, ChatSessionStatus, RequestNode, WakeNote } from './model';

const wakeLog = getLogger().scope('chat:wake');

const COLUMNS: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

export async function taskName(projectPath: string, taskNumber: number): Promise<string> {
  return (await getTaskByNumber(projectPath, taskNumber))?.name ?? `T-${taskNumber}`;
}

/** A task as Chat is told about it: its name, number and project, named as the sidebar and `project list` name it. */
export async function describeTask(projectPath: string, taskNumber: number): Promise<string> {
  return `${await taskName(projectPath, taskNumber)} (T-${taskNumber} in ${path.basename(projectPath)})`;
}

export async function describeSession(info: ChatSessionInfo): Promise<string> {
  const who = info.taskId != null ? await describeTask(info.projectPath, info.taskId) : (info.label ?? info.id);
  return `${who}, chat ${info.id},`;
}

/** A session as the person reading the transcript knows it: its task's name, or its card's. */
export async function sessionName(info: ChatSessionInfo): Promise<string> {
  return info.taskId != null ? taskName(info.projectPath, info.taskId) : (info.label ?? 'A chat');
}

const eventNote = (text: string): WakeNote => ({ kind: 'event', text });

/** What a session works on, so news of it goes to the conversation that started the task. */
export function sessionTask(id: string): TaskRef | null {
  const context = getSessionTaskContext(id);
  return context ? { projectPath: context.projectPath, taskNumber: context.taskId } : null;
}

const mailbox = new Mailbox({
  exists: (id) => chatHost.roleOf(id) !== null,
  ready: (id) => chatHost.isLive(id) && chatHost.snapshot(id)?.info.status === 'idle',
  send: async (id, text, notes) => {
    try {
      await chatHost.prompt(id, { text, wake: true, notes });
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
export async function wakeHomeChat(
  kind: WakeEvent | null,
  text: string,
  note: WakeNote,
  about?: TaskRef | null,
): Promise<void> {
  if (kind && !(await loadHomeChatSettings()).wake[kind]) return;
  const to = (about && taskOwner(about.projectPath, about.taskNumber)) ?? homeChatCurrent();
  if (to) await mailbox.post(to, text, note);
}

/** Straight to one conversation, whatever the settings: the answer to something it asked. */
export function tellConversation(id: string, text: string, note: WakeNote): Promise<void> {
  return mailbox.post(id, text, note);
}

/**
 * A move a decision of Chat's makes is told as that decision's outcome, so
 * the column change it causes is not told again.
 */
const quiet = new Set<string>();

export function quietMove(projectPath: string, taskNumber: number): () => void {
  const key = `${projectPath}#${taskNumber}`;
  quiet.add(key);
  return () => quiet.delete(key);
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
  const name = info
    ? await sessionName(info)
    : context?.taskId != null
      ? await taskName(context.projectPath, context.taskId)
      : 'A terminal';
  await wakeHomeChat(
    'asked',
    `${who} is waiting on the user to run \`${command}\` outside its sandbox${why}. Only the user can run it.`,
    eventNote(`${name} asks you to run \`${command}\``),
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
        void Promise.all([describeSession(info), sessionName(info)]).then(([who, name]) =>
          wakeHomeChat(
            'turnEnded',
            `${who} finished its turn.`,
            eventNote(`${name} finished its turn`),
            sessionTask(sessionId),
          ),
        );
      }
      return;
    }
    if (event.type === 'node' && event.node.kind === 'request' && event.node.status === 'pending') {
      const request = event.node as RequestNode;
      void Promise.all([describeSession(info), sessionName(info)]).then(([who, name]) =>
        wakeHomeChat(
          'asked',
          `${who} is waiting on an approval: ${request.title} (request ${request.id}).`,
          eventNote(`${name} asks for approval: ${request.title}`),
          sessionTask(sessionId),
        ),
      );
    }
  });
  taskEvents.on('status', (change: TaskStatusChange) => {
    if (quiet.has(`${change.projectPath}#${change.taskNumber}`)) return;
    const to = COLUMNS[change.to] ?? change.to;
    void Promise.all([
      describeTask(change.projectPath, change.taskNumber),
      taskName(change.projectPath, change.taskNumber),
    ]).then(([who, name]) =>
      wakeHomeChat(
        'taskMoved',
        `${who} moved from ${COLUMNS[change.from] ?? change.from} to ${to}.`,
        eventNote(`${name} moved to ${to}`),
        change,
      ),
    );
  });
}
