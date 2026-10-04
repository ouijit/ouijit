import type { ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../types';

/**
 * The whole row opens the item, but the row cannot itself be a button: it holds
 * buttons, and nesting them is invalid and unreachable by keyboard. The title
 * button stretches over the row with a `::before`, and the controls that need
 * their own click are raised above it.
 */
export function rowClass(active: boolean): string {
  return `group relative w-full px-4 py-2 flex flex-col gap-0.5 transition-colors duration-100 ${
    active ? 'bg-ink/[0.07]' : 'hover:bg-ink/[0.04]'
  }`;
}

export const rowTitleClass = "flex items-baseline gap-2 text-left before:absolute before:inset-0 before:content-['']";

/** A control inside a row, raised above the title's stretched hit area. */
export const rowActionClass = 'relative z-10 shrink-0';

export function TaskLink({ task, onOpen }: { task: TaskWithWorkspace; onOpen: (task: TaskWithWorkspace) => void }) {
  return (
    <button
      type="button"
      className={`${rowActionClass} font-mono text-[12px] text-text-tertiary hover:text-accent transition-colors duration-100`}
      title={task.name}
      onClick={() => onOpen(task)}
    >
      T-{task.taskNumber}
    </button>
  );
}

/**
 * A heading over the rows it names, and nothing when it has none. `capped` is
 * how many the group holds when that is a page rather than all of it.
 */
export function Group({ label, capped = 0, children }: { label: string; capped?: number; children: ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <section className="pt-3">
      <h2 className="px-4 pb-1 flex items-baseline gap-2 text-[13px] text-text-tertiary">
        {label}
        {capped > 0 && <span className="opacity-70">first {capped}</span>}
      </h2>
      {children}
    </section>
  );
}
