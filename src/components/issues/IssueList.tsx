import { useMemo } from 'react';
import type { IssueGroup, IssueRow } from '../../issues/types';
import { creatingKey, isRowOpen, usePanelStore, type OpenItem } from '../../stores/panelStore';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { Avatar } from './Avatar';
import { since } from './since';
import { Group, rowActionClass, rowClass, rowTitleClass, TaskLink } from './rows';
import { Spinner } from './Sections';

interface IssueListProps {
  projectPath: string;
  groups: IssueGroup[];
  /** Filters what is loaded. What the tracker itself finds for it arrives as `found`. */
  query: string;
  /** The tracker's own answer for `query`, null until it has one. */
  found: IssueRow[] | null;
  searching: boolean;
  onShowMore: (group: IssueGroup) => void;
  /** Whether a page of this group is on its way. */
  paging: (group: IssueGroup) => boolean;
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
export function IssueList({
  projectPath,
  groups,
  query,
  found,
  searching,
  onShowMore,
  paging,
  open,
  tasks,
  onOpen,
  onOpenTask,
  onCreateTask,
  loading,
}: IssueListProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = groups.map((group) => ({
      group,
      rows: q
        ? group.rows.filter((row) => [row.title, row.author, row.identifier].some((t) => t.toLowerCase().includes(q)))
        : group.rows,
    }));
    // Against what is shown rather than what is loaded: a loaded issue the
    // tracker matched on its description, which the filter cannot see, would
    // otherwise be in neither place.
    const onScreen = new Set(shown.flatMap(({ rows }) => rows.map((row) => `${row.source}:${row.key}`)));
    const more = (found ?? []).filter((row) => !onScreen.has(`${row.source}:${row.key}`));
    return { shown, more };
  }, [groups, query, found]);

  if (filtered.shown.every(({ rows }) => rows.length === 0) && filtered.more.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-text-tertiary">
        {loading ? '' : searching ? 'Searching…' : query ? 'Nothing matches that' : 'No open issues'}
      </p>
    );
  }

  const row = (row: IssueRow) => (
    <Row
      key={`${row.source}:${row.key}`}
      projectPath={projectPath}
      row={row}
      task={row.taskNumber != null ? tasks[row.taskNumber] : undefined}
      active={isRowOpen(open, row)}
      onOpen={() => onOpen(row)}
      onOpenTask={onOpenTask}
      onCreateTask={() => onCreateTask(row)}
    />
  );

  return (
    <>
      {filtered.shown.map(({ group, rows }) => (
        <Group
          key={group.label}
          label={group.label}
          {...(group.more.length > 0 && { more: { loading: paging(group), onShow: () => onShowMore(group) } })}
        >
          {rows.map(row)}
        </Group>
      ))}
      <Group label="More results">{filtered.more.map(row)}</Group>
    </>
  );
}

function Row({
  projectPath,
  row,
  task,
  active,
  onOpen,
  onOpenTask,
  onCreateTask,
}: {
  projectPath: string;
  row: IssueRow;
  task?: TaskWithWorkspace;
  active: boolean;
  onOpen: () => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTask: () => void;
}) {
  const creating = usePanelStore((s) => s.creating.includes(creatingKey(projectPath, row.source, row.key)));
  return (
    <div className={rowClass(active)}>
      <button type="button" className={rowTitleClass} onClick={onOpen}>
        <span className="flex-1 min-w-0 truncate text-[15px] text-text-primary">{row.title}</span>
        <span className="shrink-0 text-[13px] text-text-tertiary">{since(row.updatedAt)}</span>
      </button>
      <span className="flex items-center gap-2 min-w-0 text-[13px] text-text-tertiary">
        <Icon
          name={row.icon}
          className={`w-3.5 h-3.5 shrink-0 ${row.tone ?? ''}`}
          {...(row.iconColor ? { style: { color: row.iconColor } } : {})}
        />
        <Avatar login={row.author} url={row.authorAvatarUrl} size={16} />
        <span className="shrink-0">{row.author}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-[12px]">{row.identifier}</span>
        {creating ? (
          <span role="status" className="shrink-0 flex items-center gap-1.5 text-[13px] text-text-secondary">
            <Spinner />
            Creating task…
          </span>
        ) : task ? (
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
