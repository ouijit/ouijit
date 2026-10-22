import type { ReactNode } from 'react';
import type { TaskStatus } from '../../ouijit-ui/types';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';
import { featuresTasks, featuresTerminalsByTask } from './featuresFixtures';

export type DemoPage = 'board' | 'prs' | 'analysis';

/** The terminal the demo treats as having finished while you were elsewhere. */
export const DEMO_WAITING = 'pty-103-test';

const STAGES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
const STAGE_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

const ROW = 'w-full h-7 flex items-center gap-2 pl-2 pr-2.5 rounded-[7px] text-[13px] text-left whitespace-nowrap';
const DIM = 'color-mix(in srgb, var(--color-text-primary) 62%, transparent)';

const tasksWithTerminals = featuresTasks
  .filter((task) => featuresTerminalsByTask[task.taskNumber]?.length)
  .sort((a, b) => STAGES.indexOf(a.status) - STAGES.indexOf(b.status));

function StageIcon({ status }: { status: TaskStatus }) {
  return (
    <span
      role="img"
      aria-label={STAGE_LABELS[status]}
      className="w-3.5 h-3.5 flex items-center justify-center shrink-0"
      style={{ color: 'color-mix(in srgb, var(--color-ink) 32%, transparent)' }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {status === 'todo' && (
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2" />
        )}
        {status !== 'todo' && status !== 'done' && (
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        )}
        {status === 'in_progress' && <path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />}
        {status === 'in_review' && (
          <path
            d="M5.6 8.2l1.7 1.7 3.1-3.3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {status === 'done' && (
          <>
            <circle cx="8" cy="8" r="6.25" fill="currentColor" />
            <path
              d="M5.5 8.2l1.8 1.8 3.4-3.6"
              stroke="var(--color-background)"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </span>
  );
}

function Row({
  icon,
  title,
  bright,
  selected,
  mono,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  bright: boolean;
  selected: boolean;
  mono?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`${ROW} ${selected ? 'bg-ink/10' : 'hover:bg-ink/5'}`} onClick={onClick}>
      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">{icon}</span>
      <span
        className={`flex-1 min-w-0 truncate ${mono ? 'font-mono text-[11.5px]' : ''}`}
        style={{ color: bright ? 'var(--color-text-primary)' : DIM }}
      >
        {title}
      </span>
      {trailing}
    </button>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="h-[26px] flex items-center pl-2.5 pr-0.5 text-[11.5px] font-semibold text-text-secondary">
      {children}
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
  shown,
  waiting,
  onPage,
  onTerminal,
  onHide,
  searching,
  onSearch,
}: {
  page: DemoPage | null;
  shown: string | null;
  waiting: boolean;
  onPage: (page: DemoPage) => void;
  onTerminal: (ptyId: string) => void;
  onHide: () => void;
  searching: boolean;
  onSearch: () => void;
}) {
  const dot = (status: string, unread = false) => (
    <span className="w-3.5 flex items-center justify-center shrink-0">
      <StatusDot status={status} unread={unread} />
    </span>
  );

  return (
    <div
      className="flex flex-col shrink-0 h-full"
      style={{
        width: 264,
        background: 'color-mix(in srgb, var(--color-surface) 22%, var(--color-background))',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      <div className="h-16 shrink-0 flex items-center justify-end gap-0.5 px-2.5">
        <button
          type="button"
          aria-label="Toggle search"
          aria-expanded={searching}
          className={`w-9 h-9 flex items-center justify-center rounded-[10px] [&>svg]:w-5 [&>svg]:h-5 ${
            searching ? 'text-text-primary bg-background-secondary' : 'text-text-secondary'
          }`}
          onClick={onSearch}
        >
          <Icon name="magnifying-glass" />
        </button>
        <button
          type="button"
          aria-label="Hide sidebar"
          className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary [&>svg]:w-5 [&>svg]:h-5"
          onClick={onHide}
        >
          <Icon name="sidebar-simple" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden px-2.5 flex flex-col">
        <Heading>
          <span className="flex gap-3">
            <span>Projects</span>
            <span className="text-text-tertiary">Tags</span>
          </span>
        </Heading>
        <div className={`h-7 flex items-center gap-0.5 px-1 rounded-[7px] ${page ? 'bg-ink/10' : ''}`}>
          <span className="w-5 h-7 flex items-center justify-center shrink-0 text-text-secondary">
            <Icon name="caret-down" className="w-3 h-3" />
          </span>
          <span className="flex-1 min-w-0 truncate pl-0.5 text-[13px] font-medium text-text-primary">horizon</span>
          <span className="flex gap-px shrink-0">
            {PAGE_BUTTONS.map(({ page: target, icon, label }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                className={`w-6 h-6 flex items-center justify-center rounded-md ${
                  target && page === target
                    ? 'bg-ink/10 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
                onClick={target ? () => onPage(target) : undefined}
              >
                <Icon name={icon} className="w-3.5 h-3.5" />
              </button>
            ))}
          </span>
        </div>
        {tasksWithTerminals.map((task) => {
          const terminals = featuresTerminalsByTask[task.taskNumber];
          const unread = waiting && terminals.some((d) => d.ptyId === DEMO_WAITING);
          if (terminals.length === 1) {
            const [only] = terminals;
            return (
              <Row
                key={task.taskNumber}
                icon={<StageIcon status={task.status} />}
                title={task.name}
                bright={unread || shown === only.ptyId}
                selected={shown === only.ptyId}
                trailing={dot(only.status, unread && shown !== only.ptyId)}
                onClick={() => onTerminal(only.ptyId)}
              />
            );
          }
          return (
            <div key={task.taskNumber} className="flex flex-col">
              <Row
                icon={<StageIcon status={task.status} />}
                title={task.name}
                bright={unread}
                selected={false}
                onClick={() => onTerminal(terminals[0].ptyId)}
              />
              {terminals.map((d) => (
                <Row
                  key={d.ptyId}
                  icon={<span className="font-mono text-xs opacity-45">└</span>}
                  title={d.lastOscTitle || d.label}
                  mono
                  bright={shown === d.ptyId}
                  selected={shown === d.ptyId}
                  trailing={dot(d.status, waiting && d.ptyId === DEMO_WAITING && shown !== d.ptyId)}
                  onClick={() => onTerminal(d.ptyId)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 px-2.5 pt-2 pb-3 border-t border-separator">
        {[
          ['plus', 'Add project'],
          ['gear', 'Settings'],
        ].map(([icon, label]) => (
          <span key={label} className="h-7 flex items-center gap-2.5 pl-1.5 text-[13px] text-text-secondary">
            <Icon name={icon} className="w-3.5 h-3.5" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
