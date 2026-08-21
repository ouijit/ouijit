import { useState, type ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { STATUS_LABELS } from '../kanban/taskMenu';

export function Dot() {
  return <span className="text-text-tertiary opacity-60">·</span>;
}

/** One label-and-value row. The label column is fixed so the values line up. */
export function Fact({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="flex items-center gap-2 w-[150px] shrink-0 text-[15px] text-text-tertiary">
        <Icon name={icon} className="w-4 h-4 shrink-0 opacity-70" />
        {label}
      </dt>
      <dd className="flex items-center gap-1.5 min-w-0 flex-wrap text-[15px]">{children}</dd>
    </div>
  );
}

/**
 * The task tracking this pull request or issue, or the offer to create one.
 * Creating means different things for the two, so the caller supplies wording.
 */
export function TaskFact({
  task,
  openTaskLabel,
  onOpenTask,
  createLabel,
  createTitle,
  onCreate,
}: {
  task?: TaskWithWorkspace;
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  createLabel: string;
  createTitle: string;
  onCreate: () => void;
}) {
  return (
    <Fact icon="user-circle" label="Task">
      {task ? (
        <button
          type="button"
          className="flex items-center gap-1.5 text-[15px] text-text-primary hover:text-accent transition-colors duration-100"
          title={openTaskLabel ? `${openTaskLabel(task)} — ${task.name}` : task.name}
          onClick={() => onOpenTask(task)}
        >
          <span className="font-mono text-[13px]">T-{task.taskNumber}</span>
          <span className="text-text-tertiary">{STATUS_LABELS[task.status] ?? task.status}</span>
          <Icon name="arrow-right" className="w-3.5 h-3.5 opacity-60" />
        </button>
      ) : (
        <button
          type="button"
          className="text-[15px] text-text-tertiary hover:text-accent transition-colors duration-100"
          title={createTitle}
          onClick={onCreate}
        >
          {createLabel}
        </button>
      )}
    </Fact>
  );
}

export function Section({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="group flex items-center gap-2 pb-2.5 border-b border-ink/[0.08] text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[19px] font-medium text-text-primary">{label}</span>
        <Icon
          name="caret-right"
          className={`w-4 h-4 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        {count != null && count > 0 && <span className="text-[15px] text-text-tertiary">{count}</span>}
      </button>
      {open && <div className="pt-4">{children}</div>}
    </section>
  );
}

export function LabelChips({ labels }: { labels: Array<{ name: string; color: string }> }) {
  return (
    <>
      {labels.map((label) => (
        <span key={label.name} className="flex items-center gap-1.5 text-[15px] text-text-primary">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: `#${label.color}` }} />
          {label.name}
        </span>
      ))}
    </>
  );
}
