import { useMemo } from 'react';
import type { IssueGroup, IssueRow } from '../../issues/types';
import { issueOpenItem, openKey, type OpenItem } from '../../stores/panelStore';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { Avatar } from './Avatar';
import { since } from './since';
import { rowActionClass, rowClass, rowTitleClass, TaskLink } from './rows';

interface IssueListProps {
  groups: IssueGroup[];
  /** Filters what is loaded rather than querying, so a capped group stays honest. */
  query: string;
  /** What the panel has open, so the row that is it can say so. */
  open: OpenItem;
  /** By task number, which is what a row's `taskNumber` names. */
  tasks: Record<number, TaskWithWorkspace>;
  onOpen: (row: IssueRow) => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTask: (row: IssueRow) => void;
  loading: boolean;
}

/**
 * The Issues list, over every source that has something to put in it. A group
 * is named for what it answers rather than for who answered it, so an `ENG-231`
 * and a `#299` sit in one `Assigned to you`.
 */
export function IssueList({ groups, query, open, tasks, onOpen, onOpenTask, onCreateTask, loading }: IssueListProps) {
  const activeKey = open ? openKey(open) : null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        [row.title, row.author, row.identifier].some((text) => text.toLowerCase().includes(q)),
      ),
    }));
  }, [groups, query]);

  if (filtered.every((group) => group.rows.length === 0)) {
    return (
      <p className="px-4 py-8 text-center text-sm text-text-tertiary">
        {loading ? '' : query ? 'Nothing matches that' : 'No open issues'}
      </p>
    );
  }

  return (
    <>
      {filtered.map((group) => (
        <Group key={group.label} label={group.label} capped={group.capped}>
          {group.rows.map((row) => (
            <Row
              key={`${row.source}:${row.key}`}
              row={row}
              task={row.taskNumber != null ? tasks[row.taskNumber] : undefined}
              active={activeKey === openKey(issueOpenItem(row))}
              onOpen={() => onOpen(row)}
              onOpenTask={onOpenTask}
              onCreateTask={() => onCreateTask(row)}
            />
          ))}
        </Group>
      ))}
    </>
  );
}

function Group({ label, capped, children }: { label: string; capped: boolean; children: React.ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <section className="pt-3">
      <h2 className="px-4 pb-1 flex items-baseline gap-2 text-[13px] text-text-tertiary">
        {label}
        {capped && <span className="opacity-70">first {children.length}</span>}
      </h2>
      {children}
    </section>
  );
}

function Row({
  row,
  task,
  active,
  onOpen,
  onOpenTask,
  onCreateTask,
}: {
  row: IssueRow;
  task?: TaskWithWorkspace;
  active: boolean;
  onOpen: () => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTask: () => void;
}) {
  return (
    <div className={rowClass(active)}>
      <button type="button" className={rowTitleClass} onClick={onOpen}>
        <span className="flex-1 min-w-0 truncate text-[15px] text-text-primary">{row.title}</span>
        <span className="shrink-0 text-[13px] text-text-tertiary">{since(row.updatedAt)}</span>
      </button>
      <span className="flex items-center gap-2 min-w-0 text-[13px] text-text-tertiary">
        <Icon name={row.icon} className={`w-3.5 h-3.5 shrink-0 ${row.tone}`} />
        <Avatar login={row.author} url={row.authorAvatarUrl} size={16} />
        <span className="shrink-0">{row.author}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-[12px]">{row.identifier}</span>
        {task ? (
          <TaskLink task={task} onOpen={onOpenTask} />
        ) : (
          <button
            type="button"
            className={`${rowActionClass} text-[13px] text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-accent transition-all duration-100`}
            onClick={onCreateTask}
          >
            Create task
          </button>
        )}
      </span>
    </div>
  );
}
