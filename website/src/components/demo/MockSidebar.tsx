import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskStatus } from '../../ouijit-ui/types';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';
import { featuresTasks, featuresTerminalsByTask } from './featuresFixtures';

export type DemoPage = 'board' | 'prs' | 'analysis';

/** The terminal the demo treats as having finished while you were elsewhere. */
export const DEMO_WAITING = 'pty-103-test';

const STAGE_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

const ROW =
  'w-full h-7 flex items-center gap-2 pl-2 pr-2.5 rounded-[7px] text-[13px] text-left whitespace-nowrap transition-colors duration-100';
const ROW_IDLE = 'hover:bg-ink/5';
const ROW_SELECTED = 'bg-accent/15';
const DIM = 'color-mix(in srgb, var(--color-text-primary) 62%, transparent)';
const ROW_BUTTON = 'w-6 h-6 flex items-center justify-center rounded-md transition-colors duration-100';

/** The project's in-progress and in-review tasks, in board order, listed with or without a terminal. */
const listedTasks = (['in_progress', 'in_review'] as const).flatMap((status) =>
  featuresTasks.filter((task) => task.status === status),
);
const todos = featuresTasks.filter((task) => task.status === 'todo');

function StageGlyph({ status }: { status: TaskStatus }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ color: 'color-mix(in srgb, var(--color-ink) 32%, transparent)' }}
    >
      {status === 'todo' && (
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2" />
      )}
      {(status === 'in_progress' || status === 'in_review') && (
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      )}
      {status === 'in_progress' && <path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />}
      {status === 'in_review' && <path d="M8 8V4.5A3.5 3.5 0 1 1 4.5 8z" fill="currentColor" />}
      {status === 'done' && (
        <>
          <circle cx="8" cy="8" r="6.25" fill="currentColor" />
          <path
            d="M5.5 8.2l1.8 1.8 3.4-3.6"
            stroke="var(--sidebar-bg)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

function StageIcon({ status }: { status: TaskStatus }) {
  return (
    <span role="img" aria-label={STAGE_LABELS[status]} className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
      <StageGlyph status={status} />
    </span>
  );
}

function TodoStackGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle
        cx="10"
        cy="6"
        r="4.4"
        stroke="color-mix(in srgb, var(--color-ink) 20%, transparent)"
        strokeWidth="1.4"
        strokeDasharray="1.9 1.8"
      />
      <circle
        cx="6.5"
        cy="9.5"
        r="4.4"
        fill="var(--sidebar-bg)"
        stroke="color-mix(in srgb, var(--color-ink) 36%, transparent)"
        strokeWidth="1.4"
        strokeDasharray="1.9 1.8"
      />
    </svg>
  );
}

function Row({
  icon,
  title,
  bright,
  unread = false,
  selected = false,
  mono,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  bright: boolean;
  unread?: boolean;
  selected?: boolean;
  mono?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className={`${ROW} ${selected ? ROW_SELECTED : ROW_IDLE} cursor-default select-none`}
      data-sidebar-row
      data-selected={selected || undefined}
      onClick={onClick}
    >
      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">{icon}</span>
      <button
        type="button"
        className="flex-1 min-w-0 h-full flex items-center gap-2 bg-transparent border-none p-0 text-left outline-none"
        aria-current={selected ? 'true' : undefined}
      >
        <span
          className={`flex-1 min-w-0 truncate ${mono ? 'font-mono text-[11.5px]' : ''}`}
          style={{ color: bright ? 'var(--color-text-primary)' : DIM, fontWeight: unread ? 600 : undefined }}
        >
          {title}
        </span>
        {trailing}
      </button>
    </div>
  );
}

function StatusSlot({ status, unread }: { status: string; unread: boolean }) {
  return (
    <span className="w-3.5 flex items-center justify-center shrink-0">
      <StatusDot status={status} unread={unread} />
    </span>
  );
}

function IdleMark() {
  return (
    <span aria-label="No terminal open" className="w-3.5 flex items-center justify-center shrink-0 text-text-tertiary">
      <Icon name="moon" className="w-3 h-3" />
    </span>
  );
}

/** The row for a project's waiting to-dos, opening the menu that lists them. */
function TodoMenuRow({ onPick }: { onPick: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${ROW} ${open ? 'bg-ink/[0.06]' : ROW_IDLE} cursor-default select-none`}
        onClick={() => setOpen(!open)}
      >
        <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
          <TodoStackGlyph />
        </span>
        <span className="flex-1 min-w-0 truncate" style={{ color: open ? 'var(--color-text-primary)' : DIM }}>
          To do
        </span>
        <span className="shrink-0 min-w-[18px] h-[17px] px-1.5 rounded-full bg-ink/[0.07] flex items-center justify-center text-[11px] font-medium text-text-secondary">
          {todos.length}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[34px] w-64 flex flex-col overflow-hidden glass-bevel border border-bezel rounded-[12px] z-[500]"
          style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-menu)' }}
        >
          <div className="min-h-0 overflow-y-auto p-1">
            {todos.map((task) => (
              <button
                key={task.taskNumber}
                type="button"
                role="menuitem"
                className="w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-100"
                onClick={() => {
                  setOpen(false);
                  onPick();
                }}
              >
                <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                  <StageGlyph status="todo" />
                </span>
                <span className="flex-1 truncate">{task.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_BUTTONS: { page: DemoPage | null; icon: string; label: string }[] = [
  { page: 'board', icon: 'kanban', label: 'Board' },
  { page: null, icon: 'plus', label: 'New task' },
  { page: null, icon: 'dots-three', label: 'More' },
];

/** The app's sidebar, over the homepage demo's fixtures. */
export function MockSidebar({
  page,
  onScreen,
  waiting,
  onPage,
  onTerminal,
  onTerminalAlone,
  onTask,
  onHide,
  searching,
  onSearch,
}: {
  page: DemoPage | null;
  /** The terminals in the stack on screen, none while a page is. */
  onScreen: string[];
  waiting: boolean;
  onPage: (page: DemoPage) => void;
  /** Shows the terminal with the rest of its task's. */
  onTerminal: (ptyId: string) => void;
  /** Shows the terminal on its own, as picking one of a task's several does. */
  onTerminalAlone: (ptyId: string) => void;
  /** Shows a task's terminals together. */
  onTask: (taskNumber: number) => void;
  onHide: () => void;
  searching: boolean;
  onSearch: () => void;
}) {
  const unreadIn = (ptyId: string) => waiting && ptyId === DEMO_WAITING && onScreen[0] !== ptyId;

  return (
    <div
      className="flex flex-col shrink-0 h-full"
      style={
        {
          '--sidebar-bg': 'color-mix(in srgb, var(--color-surface) 22%, var(--color-background))',
          width: 264,
          background: 'var(--sidebar-bg)',
        } as React.CSSProperties
      }
    >
      <div className="h-[72px] shrink-0 flex items-center justify-end gap-0.5 px-2.5">
        <button
          type="button"
          aria-label="Toggle search"
          aria-expanded={searching}
          className={`w-9 h-9 flex items-center justify-center rounded-[10px] transition-colors duration-150 hover:bg-background-secondary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5 ${
            searching ? 'bg-background-secondary text-text-primary' : 'text-text-secondary'
          }`}
          onClick={onSearch}
        >
          <Icon name="magnifying-glass" />
        </button>
        <button
          type="button"
          aria-label="Hide sidebar"
          className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
          onClick={onHide}
        >
          <Icon name="sidebar-simple" />
        </button>
      </div>
      <div className="flex-1 min-h-0 px-2.5 pt-1 pb-4 flex flex-col">
        <div className="h-[26px] shrink-0 flex items-center pl-2.5 pr-0.5 text-[11.5px] font-semibold">
          <span className="flex gap-3">
            <span className="text-text-secondary">Projects</span>
            <span className="text-text-tertiary">Tags</span>
          </span>
        </div>
        <div
          className={`h-7 flex items-center gap-0.5 px-1 rounded-[7px] ${page ? ROW_SELECTED : ROW_IDLE}`}
          data-selected={page ? true : undefined}
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0 text-text-secondary">
            <Icon name="caret-right" className="w-3 h-3" style={{ transform: 'rotate(90deg)' }} />
          </span>
          <span className="flex-1 min-w-0 h-7 flex items-center gap-2 pl-0.5 pr-1 text-[13px] font-medium text-text-primary">
            <span
              aria-hidden="true"
              className="w-4 h-4 shrink-0 rounded flex items-center justify-center text-[7px] font-bold text-white"
              style={{ backgroundColor: '#e9679f', textShadow: '0 1px 1px rgba(0, 0, 0, 0.2)' }}
            >
              HO
            </span>
            <span className="truncate flex-1 min-w-0">horizon</span>
          </span>
          <span className="flex gap-px shrink-0">
            {PAGE_BUTTONS.map(({ page: target, icon, label }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                className={`${ROW_BUTTON} ${
                  target && page === target
                    ? 'bg-ink/10 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-ink/10'
                }`}
                onClick={target ? () => onPage(target) : undefined}
              >
                <Icon name={icon} className="w-3.5 h-3.5" />
              </button>
            ))}
          </span>
        </div>
        <TodoMenuRow onPick={() => onPage('board')} />
        {listedTasks.map((task) => {
          const terminals = featuresTerminalsByTask[task.taskNumber] ?? [];
          if (terminals.length === 0) {
            return (
              <Row
                key={task.taskNumber}
                icon={<StageIcon status={task.status} />}
                title={task.name}
                bright={false}
                trailing={<IdleMark />}
              />
            );
          }
          if (terminals.length === 1) {
            const [only] = terminals;
            const unread = unreadIn(only.ptyId);
            return (
              <Row
                key={task.taskNumber}
                icon={<StageIcon status={task.status} />}
                title={task.name}
                bright={unread || onScreen[0] === only.ptyId}
                unread={unread}
                selected={onScreen.includes(only.ptyId)}
                trailing={<StatusSlot status={only.status} unread={unread} />}
                onClick={() => onTerminal(only.ptyId)}
              />
            );
          }
          const anyUnread = terminals.some((d) => unreadIn(d.ptyId));
          return [
            <Row
              key={task.taskNumber}
              icon={<StageIcon status={task.status} />}
              title={task.name}
              bright={anyUnread}
              unread={anyUnread}
              selected={terminals.every((d) => onScreen.includes(d.ptyId))}
              onClick={() => onTask(task.taskNumber)}
            />,
            ...terminals.map((d) => (
              <Row
                key={d.ptyId}
                icon={<span className="font-mono text-xs opacity-45">└</span>}
                title={d.lastOscTitle || d.label}
                mono
                bright={unreadIn(d.ptyId) || onScreen[0] === d.ptyId}
                unread={unreadIn(d.ptyId)}
                selected={onScreen.includes(d.ptyId)}
                trailing={<StatusSlot status={d.status} unread={unreadIn(d.ptyId)} />}
                onClick={() => onTerminalAlone(d.ptyId)}
              />
            )),
          ];
        })}
      </div>
      <div className="shrink-0 px-2.5 pt-2 pb-3 pane-seam-top">
        {[
          ['plus', 'Add project'],
          ['gear', 'Settings'],
        ].map(([icon, label]) => (
          <span
            key={label}
            className="w-full h-7 flex items-center gap-2.5 pl-1.5 rounded-[7px] text-[13px] text-text-secondary"
          >
            <Icon name={icon} className="w-3.5 h-3.5" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
