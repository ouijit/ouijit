import { askPlace, askVerb } from '../../types';
import { useEffect, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { useAppStore } from '../../stores/appStore';
import { isHomeChat, useHomeChatStore, useIsHomeChat } from '../../stores/homeChatStore';
import { taskKey } from '../../chat/preferences';
import { pendingRequests, type RequestNode } from '../../chat/model';
import { runWaiting } from '../waiting/WaitingDialog';
import { useRevealGate } from './ChatTurns';
import { ChatRequestView } from './ChatRequest';

/** The conversation a queued item came from: Chat itself, or a task one of its conversations started. */
export function useOwnerOf(): (item: Waiting) => string | null {
  const owners = useHomeChatStore((s) => s.owners);
  const displays = useTerminalStore((s) => s.displayStates);
  return (item) => {
    if (isHomeChat(item.from)) return item.from;
    if (item.kind === 'move') return owners[taskKey(item.projectPath, item.taskNumber)] ?? null;
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
          <span className="font-mono text-[12px] font-medium text-text-primary overflow-hidden whitespace-nowrap">
            {title}
          </span>
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
  if (item.kind === 'ask' && item.ask.url) {
    return (
      <Card
        title={`${asker} asks to open this page`}
        actions={
          <>
            <button type="button" className="btn-secondary btn-compact" onClick={remove}>
              Decline
            </button>
            <button type="button" className="btn-primary btn-compact" onClick={() => runWaiting(item)}>
              Open
            </button>
          </>
        }
      >
        <Command text={item.ask.url} />
        {item.ask.message && <div className="text-text-secondary">{item.ask.message}</div>}
        <div className="text-[12px] text-text-tertiary">Opens in a preview, outside the sandbox.</div>
      </Card>
    );
  }
  if (item.kind === 'ask') {
    return (
      <Card
        title={
          item.ask.shell
            ? `${asker} asks to open a shell ${askPlace(item.ask)}`
            : `${asker} asks to run this ${askPlace(item.ask)}`
        }
        actions={
          <>
            <button type="button" className="btn-secondary btn-compact" onClick={remove}>
              Decline
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={() => runWaiting(item, true)}>
              {askVerb(item.ask)} privately
            </button>
            <button type="button" className="btn-primary btn-compact" onClick={() => runWaiting(item)}>
              {askVerb(item.ask)}
            </button>
          </>
        }
      >
        <Command text={item.ask.command} />
        {item.ask.message && <div className="text-text-secondary">{item.ask.message}</div>}
        <div className="text-[12px] text-text-tertiary">
          {item.ask.shell
            ? `Outside the sandbox. Open privately and ${asker === 'Chat' ? 'Chat' : 'the agent'} cannot read it.`
            : `Runs outside the sandbox. Run privately and ${asker === 'Chat' ? 'Chat' : 'the agent'} learns only whether it succeeded.`}
        </div>
      </Card>
    );
  }
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

/** What a conversation is waiting on the user for, as cards at the end of its transcript. */
export function HomeChatDecisions({ conversation }: { conversation: string }) {
  useEffect(() => useWaitingStore.getState().cardMounted(conversation), [conversation]);
  const ownerOf = useOwnerOf();
  const queued = useWaitingStore(useShallow((s) => s.items.filter((item) => ownerOf(item) === conversation)));
  // One Chat was told of shows in full where it was told; the rest it never heard of show here.
  const told = useChatStore(
    useShallow((s) =>
      (s.sessions[conversation]?.nodes ?? []).flatMap((node) =>
        node.kind === 'user_message' ? (node.notes ?? []).flatMap((note) => note.request?.node.id ?? []) : [],
      ),
    ),
  );
  const left = useLeftToYou(conversation).filter((entry) => !told.includes(entry.request.id));
  const visible = useRevealGate([...queued.map((item) => `q${item.id}`), ...left.map((e) => e.request.id)]);
  const cards = [
    ...queued.filter((item) => visible.has(`q${item.id}`)).map((item) => <QueuedCard key={item.id} item={item} />),
    ...left
      .filter((entry) => visible.has(entry.request.id))
      .map(({ worker, name, request }) => (
        <ChatRequestView
          key={request.id}
          node={request}
          cardId={worker}
          heading={request.request === 'questions' ? `${name} has a question` : `${name} asks: ${request.title}`}
        />
      )),
  ];
  if (cards.length === 0) return null;
  return <div className="chat-said-in flex flex-col gap-3 pt-1">{cards}</div>;
}
