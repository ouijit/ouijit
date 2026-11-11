import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { useAppStore } from '../../stores/appStore';
import { isHomeChat, useHomeChatStore, useIsHomeChat } from '../../stores/homeChatStore';
import { taskKey } from '../../chat/preferences';
import { pendingRequests, type RequestNode } from '../../chat/model';
import { CONFIRM_VERB, runWaiting } from '../waiting/WaitingQueue';
import { useRevealGate } from './ChatTurns';

/** The conversation a queued item came from: Chat itself, or a task one of its conversations started. */
export function useOwnerOf(): (item: Waiting) => string | null {
  const owners = useHomeChatStore((s) => s.owners);
  const displays = useTerminalStore((s) => s.displayStates);
  return (item) => {
    if (isHomeChat(item.from)) return item.from;
    if (item.kind === 'move' || item.kind === 'confirm')
      return owners[taskKey(item.projectPath, item.taskNumber)] ?? null;
    const display = displays[item.from];
    return display?.taskId != null ? (owners[taskKey(display.projectPath, display.taskId)] ?? null) : null;
  };
}

interface WorkerRequest {
  worker: string;
  name: string;
  request: RequestNode;
}

/** Requests from a conversation's workers that it finished its turn without answering, so they are the user's. */
function useLeftToYou(conversation: string): WorkerRequest[] {
  const owners = useHomeChatStore((s) => s.owners);
  const idle = useChatStore((s) => s.sessions[conversation]?.info.status === 'idle');
  const sessions = useChatStore((s) => s.sessions);
  const tasks = useAppStore((s) => s.taskCacheByProject);
  if (!idle) return [];
  return Object.values(sessions).flatMap(({ info, nodes }) => {
    if (info.taskId == null || owners[taskKey(info.projectPath, info.taskId)] !== conversation) return [];
    const name = tasks[info.projectPath]?.find((t) => t.taskNumber === info.taskId)?.name ?? `T-${info.taskId}`;
    return pendingRequests(nodes).map((request) => ({ worker: info.id, name, request }));
  });
}

/** How many things a conversation is waiting on the user for. */
export function useWaitingCount(conversation: string): number {
  const ownerOf = useOwnerOf();
  const queued = useWaitingStore(useShallow((s) => s.items.filter((item) => ownerOf(item) === conversation)));
  return queued.length + useLeftToYou(conversation).length;
}

function Card({ title, actions, children }: { title: string; actions: ReactNode; children?: ReactNode }) {
  return (
    <div
      className="glass-bevel relative border border-bezel-panel rounded-[14px] overflow-hidden bg-terminal-bg"
      data-chat-decision
    >
      <div className="flex items-center justify-between gap-3 min-h-9 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: 'var(--color-status-unread)' }}
            aria-hidden="true"
          />
          <span className="font-mono text-[12px] font-medium text-text-primary truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      </div>
      {children && <div className="px-3.5 pb-3 flex flex-col gap-2.5 text-[13px] leading-snug">{children}</div>}
    </div>
  );
}

function Command({ text }: { text: string }) {
  return (
    <pre className="m-0 px-2.5 py-2 rounded-[8px] bg-ink/[0.05] font-mono text-[12px] leading-[18px] text-text-primary whitespace-pre-wrap break-all">
      {text}
    </pre>
  );
}

function useTaskName(projectPath: string, taskNumber: number): string {
  return useAppStore(
    (s) => s.taskCacheByProject[projectPath]?.find((t) => t.taskNumber === taskNumber)?.name ?? `T-${taskNumber}`,
  );
}

function useAskerName(ptyId: string): string {
  const home = useIsHomeChat(ptyId);
  const display = useTerminalStore((s) => s.displayStates[ptyId]);
  const task = useAppStore((s) =>
    display?.taskId != null
      ? s.taskCacheByProject[display.projectPath]?.find((t) => t.taskNumber === display.taskId)?.name
      : undefined,
  );
  return home ? 'Chat' : (task ?? display?.label ?? 'A terminal');
}

function QueuedCard({ item }: { item: Waiting }) {
  const remove = () => useWaitingStore.getState().remove(item.id);
  const asker = useAskerName(item.from);
  const taskName = useTaskName(item.kind === 'ask' ? '' : item.projectPath, item.kind === 'ask' ? -1 : item.taskNumber);
  if (item.kind === 'ask') {
    return (
      <Card
        title={`${asker} asks to run this on your computer`}
        actions={
          <>
            <button type="button" className="btn-secondary btn-compact" onClick={remove}>
              Decline
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={() => runWaiting(item, true)}>
              Run privately
            </button>
            <button type="button" className="btn-primary btn-compact" onClick={() => runWaiting(item)}>
              Run
            </button>
          </>
        }
      >
        <Command text={item.ask.command} />
        {item.ask.message && <div className="text-text-secondary">{item.ask.message}</div>}
        <div className="text-[12px] text-text-tertiary">
          Runs outside the sandbox. Run privately and {asker === 'Chat' ? 'Chat' : 'the agent'} learns only whether it
          succeeded.
        </div>
      </Card>
    );
  }
  if (item.kind === 'move') {
    return (
      <Card
        title={`${taskName}: ${item.hookName || 'hook'}`}
        actions={
          <>
            <button type="button" className="btn-secondary btn-compact" onClick={remove}>
              Skip
            </button>
            <button type="button" className="btn-primary btn-compact" onClick={() => runWaiting(item)}>
              Run
            </button>
          </>
        }
      >
        <Command text={item.command} />
        <div className="text-[12px] text-text-tertiary">
          {item.outsideSandbox ? 'Runs on your computer, outside the sandbox.' : 'Runs in its sandbox.'}
        </div>
      </Card>
    );
  }
  return (
    <Card
      title={`${CONFIRM_VERB[item.action]} ${taskName}`}
      actions={
        <>
          <button type="button" className="btn-secondary btn-compact" onClick={remove}>
            Cancel
          </button>
          <button type="button" className="btn-primary btn-compact" onClick={() => runWaiting(item)}>
            {CONFIRM_VERB[item.action]}
          </button>
        </>
      }
    >
      <div className="text-text-secondary">
        {item.action === 'done'
          ? 'Moves it to done, which runs its done hook.'
          : 'Its folder goes to the system trash, where you can still get it back.'}
      </div>
    </Card>
  );
}

function WorkerRequestCard({ worker, name, request }: WorkerRequest) {
  const allow = request.options.find((o) => o.kind === 'allow_once') ?? request.options[0];
  const deny = request.options.find((o) => o.kind === 'reject_once');
  const answer = (optionId: string) => {
    void window.api.chat.answer(worker, request.id, { kind: 'option', optionId });
  };
  return (
    <Card
      title={`${name} asks: ${request.title}`}
      actions={
        <>
          {deny && (
            <button type="button" className="btn-secondary btn-compact" onClick={() => answer(deny.id)}>
              {deny.label}
            </button>
          )}
          {allow && (
            <button type="button" className="btn-primary btn-compact" onClick={() => answer(allow.id)}>
              {allow.label}
            </button>
          )}
        </>
      }
    >
      {request.detail && <Command text={request.detail} />}
    </Card>
  );
}

/** What a conversation is waiting on the user for, as cards at the end of its transcript. */
export function HomeChatDecisions({ conversation }: { conversation: string }) {
  const ownerOf = useOwnerOf();
  const queued = useWaitingStore(useShallow((s) => s.items.filter((item) => ownerOf(item) === conversation)));
  const left = useLeftToYou(conversation);
  const visible = useRevealGate([...queued.map((item) => `q${item.id}`), ...left.map((e) => e.request.id)]);
  const cards = [
    ...queued.filter((item) => visible.has(`q${item.id}`)).map((item) => <QueuedCard key={item.id} item={item} />),
    ...left
      .filter((entry) => visible.has(entry.request.id))
      .map((entry) => <WorkerRequestCard key={entry.request.id} {...entry} />),
  ];
  if (cards.length === 0) return null;
  return <div className="chat-said-in flex flex-col gap-3 pt-1">{cards}</div>;
}
