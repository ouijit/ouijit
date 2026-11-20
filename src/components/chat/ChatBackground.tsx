import { useEffect, useRef, useState } from 'react';
import { Icon } from '../terminal/Icon';
import { Span, useNow } from './ChatNodes';
import type { ChatBackgroundTask, ChatNode, ChatSessionInfo, NoticeNode } from '../../chat/model';

/** How much of a task's output shows when its row is opened. */
const TAIL_LINES = 4;
/** How long an ended task stays in the bar, saying how it ended, before it leaves. */
const LINGER_MS = 4000;
const OUTPUT_POLL_MS = 1000;

type Ended = NoticeNode['ended'];

function BackgroundDots() {
  return (
    <span className="background-dots w-3.5 justify-center shrink-0" aria-hidden>
      <span />
      <span />
    </span>
  );
}

/** The end of what a task has printed, read again each second while its row is open. */
function useTail(cardId: string, taskId: string, open: boolean): string | null {
  const [tail, setTail] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const read = () =>
      void window.api.chat
        .backgroundOutput(cardId, taskId)
        .then((output) => live && setTail(output === null ? null : lastLines(output)))
        .catch(() => {});
    read();
    const timer = setInterval(read, OUTPUT_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [cardId, taskId, open]);
  return tail;
}

function lastLines(text: string): string {
  return text.replace(/\s+$/, '').split('\n').slice(-TAIL_LINES).join('\n');
}

function TaskRow({ cardId, task, ended }: { cardId: string; task: ChatBackgroundTask; ended?: Ended }) {
  const [open, setOpen] = useState(false);
  const now = useNow(!ended);
  const tail = useTail(cardId, task.id, open && !ended);
  return (
    <li className="group">
      <div className="flex items-center gap-2.5 px-3 h-8 text-[13px] text-text-secondary">
        {ended ? (
          <Icon
            name={ended.status === 'failed' ? 'x-circle' : ended.status === 'stopped' ? 'prohibit' : 'check'}
            className={`w-3.5 h-3.5 shrink-0 ${ended.status === 'failed' ? 'text-error' : 'text-text-tertiary'}`}
          />
        ) : (
          <BackgroundDots />
        )}
        <button
          type="button"
          aria-expanded={open}
          disabled={Boolean(ended) || task.kind !== 'shell'}
          className="flex-1 min-w-0 flex items-center gap-2 text-left enabled:hover:text-text-primary transition-colors duration-100"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="min-w-0 overflow-hidden whitespace-nowrap">{task.description}</span>
          <Span ms={ended ? ended.ms : now - task.startedAt} className="text-text-tertiary" />
        </button>
        {!ended && (
          <button
            type="button"
            aria-label={`Stop ${task.description}`}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-text-tertiary hover:text-text-primary transition-opacity duration-100"
            onClick={() => void window.api.chat.stopBackground(cardId, task.id)}
          >
            <Icon name="x" className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && tail && (
        <pre className="mx-3 mb-2 ml-9 font-mono text-[12px] leading-[1.45] text-text-tertiary whitespace-pre overflow-hidden">
          {tail}
        </pre>
      )}
    </li>
  );
}

/**
 * Tasks that have just left the list, kept a moment with how they ended,
 * which the transcript's line for each says.
 */
function useLingering(tasks: ChatBackgroundTask[], nodes: ChatNode[]): { task: ChatBackgroundTask; ended: Ended }[] {
  const previous = useRef(tasks);
  const [gone, setGone] = useState<{ task: ChatBackgroundTask; until: number }[]>([]);
  useEffect(() => {
    const live = new Set(tasks.map((task) => task.id));
    const left = previous.current.filter((task) => !live.has(task.id));
    previous.current = tasks;
    if (left.length === 0) return;
    const until = Date.now() + LINGER_MS;
    setGone((current) => [...current, ...left.map((task) => ({ task, until }))]);
    const timer = setTimeout(() => setGone((current) => current.filter((g) => g.until > Date.now())), LINGER_MS);
    return () => clearTimeout(timer);
  }, [tasks]);
  const endings = new Map(
    nodes.flatMap((node) => (node.kind === 'notice' && node.ended ? [[node.ended.taskId, node.ended] as const] : [])),
  );
  return gone.flatMap(({ task }) => {
    const ended = endings.get(task.id);
    return ended ? [{ task, ended }] : [];
  });
}

/**
 * What the agent left running between turns: each with how long it has run,
 * its latest output a click away, and a way to stop it. More than one folds
 * behind a count, so a fan-out does not push the transcript off the card.
 */
export function ChatBackground({ cardId, info, nodes }: { cardId: string; info: ChatSessionInfo; nodes: ChatNode[] }) {
  const [open, setOpen] = useState(false);
  const tasks = info.background ?? [];
  const lingering = useLingering(tasks, nodes);
  const now = useNow(tasks.length > 1);
  const rows = [
    ...tasks.map((task) => <TaskRow key={task.id} cardId={cardId} task={task} />),
    ...lingering.map(({ task, ended }) => <TaskRow key={task.id} cardId={cardId} task={task} ended={ended} />),
  ];
  if (rows.length === 0) return null;

  if (rows.length === 1) {
    return (
      <ul aria-label="Running in the background" className="mx-4 mb-2 rounded-[10px] bg-ink/[0.04]">
        {rows}
      </ul>
    );
  }

  const newest = tasks.reduce<ChatBackgroundTask | undefined>(
    (latest, task) => (!latest || task.startedAt > latest.startedAt ? task : latest),
    undefined,
  );
  const oldest = Math.min(...tasks.map((task) => task.startedAt));
  return (
    <div className="mx-4 mb-2 rounded-[10px] bg-ink/[0.04]">
      <button
        type="button"
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3 h-8 text-[13px] text-text-secondary hover:text-text-primary transition-colors duration-100"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon
          name="caret-down"
          className={`w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
        />
        <span className="min-w-0 overflow-hidden whitespace-nowrap text-left">
          {tasks.length > 0 ? `${tasks.length} running` : 'Finished'}
          {newest && ` · ${newest.description}`}
        </span>
        {tasks.length > 0 && <Span ms={now - oldest} className="text-text-tertiary" />}
      </button>
      {open && (
        <ul aria-label="Running in the background" className="max-h-40 overflow-y-auto border-t border-separator">
          {rows}
        </ul>
      )}
    </div>
  );
}
