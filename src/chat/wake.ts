import * as path from 'node:path';
import { getLogger } from '../logger';
import { getChatRepo, getTaskByNumber } from '../db';
import { taskEvents, type TaskStatusChange } from '../taskEvents';
import { getSessionSpawnContext, getSessionTaskContext } from '../sessions';
import { chatHost } from './host';
import { Mailbox } from './mailbox';
import { loadHomeChatSettings } from './homeChat';
import { taskKey, type TaskRef, type WakeEvent } from './preferences';
import type { ChatSessionInfo, ChatSessionStatus, RequestNode, ToolCallNode, WakeNote } from './model';

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

export function taskSubject(task: TaskRef): string {
  return taskKey(task.projectPath, task.taskNumber);
}

/** A task's chat is heard about as its task, so a restarted session is still the work Chat set going. */
export function sessionSubject(id: string): string {
  const task = sessionTask(id);
  return task ? taskSubject(task) : id;
}

/**
 * A conversation follows a task, or a chat with no task, and hears what
 * happens to it; Chat hears about nothing else, so what the user drives
 * themselves stays theirs. Starting, messaging or answering something follows
 * it; the user taking it over, or it reaching done, ends that.
 */
export function follow(conversation: string, subject: string): void {
  getChatRepo().follow(subject, conversation);
}

export function unfollow(subject: string): void {
  getChatRepo().unfollow(subject);
}

export type Followed =
  { task: number; project: string; name: string; status: string } | { chat: string; label: string; status: string };

/** What a conversation follows. A task since deleted is dropped from it. */
export async function following(conversation: string): Promise<Followed[]> {
  const out: Followed[] = [];
  for (const subject of getChatRepo().following(conversation)) {
    const at = subject.lastIndexOf('#');
    const taskNumber = at === -1 ? NaN : Number(subject.slice(at + 1));
    if (Number.isInteger(taskNumber)) {
      const project = subject.slice(0, at);
      const task = await getTaskByNumber(project, taskNumber);
      if (task) out.push({ task: taskNumber, project, name: task.name, status: task.status });
      else unfollow(subject);
      continue;
    }
    const info = chatHost.snapshot(subject)?.info;
    if (info) out.push({ chat: subject, label: info.label ?? subject, status: info.status });
    else unfollow(subject);
  }
  return out;
}

/**
 * Tell the conversation following `subject` what happened, when Chat's
 * settings ask for that kind. `release` ends the following once told.
 */
export async function wakeHomeChat(
  kind: WakeEvent | null,
  text: string,
  note: WakeNote,
  subject: string | null,
  { release = false }: { release?: boolean } = {},
): Promise<void> {
  const to = subject ? getChatRepo().follower(subject) : null;
  if (!to) return;
  if (release) unfollow(subject!);
  if (kind && !(await loadHomeChatSettings()).wake[kind]) return;
  await mailbox.post(to, text, note);
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
    sessionSubject(ptyId),
  );
}

/** A worker's request as a line: what kind of thing it asks, with the request itself kept for showing in full. */
function requestNote(sessionId: string, info: ChatSessionInfo, name: string, request: RequestNode): WakeNote {
  const nodes = chatHost.snapshot(sessionId)?.nodes ?? [];
  const call = nodes.find((node): node is ToolCallNode => node.kind === 'tool_call' && node.id === request.toolCallId);
  // Answered while the names were being looked up: the note starts out current.
  const latest = nodes.find((node): node is RequestNode => node.kind === 'request' && node.id === request.id);
  const command = call?.tool === 'command' ? (call.command ?? request.title) : undefined;
  const edited = call?.tool === 'edit' ? call.files[0]?.path : undefined;
  const asks =
    request.request === 'questions'
      ? 'has a question'
      : command
        ? 'asked to run a command'
        : edited
          ? `asked to edit ${path.basename(edited)}`
          : 'asked for approval';
  return {
    kind: 'event',
    text: `${name} ${asks}`,
    request: {
      session: sessionId,
      name: info.taskId != null ? `${name} (T-${info.taskId})` : name,
      node: latest ?? request,
      ...(command && { command }),
    },
  };
}

function reviseRequest(sessionId: string, request: RequestNode): void {
  const revise = (note: WakeNote): WakeNote =>
    note.request?.session === sessionId && note.request.node.id === request.id
      ? { ...note, request: { ...note.request, node: request } }
      : note;
  mailbox.revise(revise);
  chatHost.reviseWakeNotes(revise);
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
            sessionSubject(sessionId),
          ),
        );
      }
      return;
    }
    if (event.type === 'node' && event.node.kind === 'request') {
      const request = event.node;
      if (request.status !== 'pending') {
        reviseRequest(sessionId, request);
        return;
      }
      void Promise.all([describeSession(info), sessionName(info)]).then(([who, name]) =>
        wakeHomeChat(
          'asked',
          `${who} is waiting on an approval: ${request.title} (request ${request.id}).`,
          requestNote(sessionId, info, name, request),
          sessionSubject(sessionId),
        ),
      );
    }
  });
  taskEvents.on('status', (change: TaskStatusChange) => {
    if (quiet.has(`${change.projectPath}#${change.taskNumber}`)) {
      if (change.to === 'done') unfollow(taskSubject(change));
      return;
    }
    // Who hears is settled as the move happens: a task Chat starts is followed only once it has moved.
    if (!getChatRepo().follower(taskSubject(change))) return;
    const to = COLUMNS[change.to] ?? change.to;
    void Promise.all([
      describeTask(change.projectPath, change.taskNumber),
      taskName(change.projectPath, change.taskNumber),
    ]).then(([who, name]) =>
      wakeHomeChat(
        'taskMoved',
        `${who} moved from ${COLUMNS[change.from] ?? change.from} to ${to}.`,
        eventNote(`${name} moved to ${to}`),
        taskSubject(change),
        { release: change.to === 'done' },
      ),
    );
  });
}
