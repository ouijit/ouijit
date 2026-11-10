import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { stackFrom, stackMembers, stackOf, terminalUnit, useTerminalStore } from '../../stores/terminalStore';
import type { TerminalDisplayState } from '../../stores/terminalDisplay';
import type { Project, SandboxBackendId, TaskWithWorkspace } from '../../types';
import { useUIStore } from '../../stores/uiStore';
import { focusTerminal, openTaskTerminal } from '../navigation';
import { openTaskSheet } from '../../utils/openTaskComposer';
import { startTodo } from '../../services/taskStartService';
import { MenuItem, MenuPopover } from '../ui/Menu';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { BranchFromTaskDialog } from '../dialogs/BranchFromTaskDialog';
import { taskEntries } from '../kanban/taskMenu';
import { renameTerminal } from '../terminal/terminalActions';
import { loadTasks, useProjectConfig } from '../../stores/projectDataStore';
import { useExperimentalStore } from '../../stores/experimentalStore';

import { Icon } from '../terminal/Icon';
import { StatusGlyph } from '../terminal/StatusDot';
import { useAsking, useWantsYou, wantsYou } from '../terminal/wantsYou';
import { Tooltip } from '../ui/Tooltip';
import { StageGlyph, StageIcon, TodoStackGlyph } from './StageIcon';
import { formatSince, groupByTask, listedOrder, unitsFor, type TaskGroup } from './sidebarTree';
import { isModKey } from '../../utils/modKey';
import { selectionEntries, TagPrompt } from './SelectionMenu';

const NO_BACKENDS: SandboxBackendId[] = [];

export const ROW =
  'w-full h-7 flex items-center gap-2 pl-2 pr-2.5 rounded-[7px] text-[13px] text-left whitespace-nowrap transition-colors duration-100';
export const ROW_IDLE = 'hover:bg-ink/5';
export const ROW_SELECTED = 'bg-accent/15';
const DIM = 'color-mix(in srgb, var(--color-text-primary) 62%, transparent)';

/** Ticks often enough for "4m" to stay true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The front card of the stack on screen, whether or not the window has focus. */
export function useShownPtyId(): string | undefined {
  const stack = useAppStore((s) => (s.selection.kind === 'terminal' ? s.selection.stack : null));
  return useTerminalStore((s) => (stack ? stackMembers(s, stack)[0] : undefined));
}

/** Every terminal in the stack on screen. */
function useOnScreen(): string[] {
  const stack = useAppStore((s) => (s.selection.kind === 'terminal' ? s.selection.stack : null));
  return useTerminalStore(useShallow((s) => (stack ? stackMembers(s, stack) : [])));
}

export function homeRelative(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}

function projectNameOf(projects: Project[], projectPath: string): string {
  return projects.find((p) => p.path === projectPath)?.name ?? homeRelative(projectPath);
}

function useProjectName(projectPath: string): string {
  return useAppStore((s) => projectNameOf(s.projects, projectPath));
}

function statusPhrase(display: TerminalDisplayState, now: number): string {
  const since = formatSince(now - display.statusSince);
  const duration = since === 'now' ? 'a moment' : since;
  return `${display.status === 'thinking' ? 'Working' : 'Ready'} for ${duration}`;
}

function rowTooltip(title: string, projectName: string, status: string): ReactNode {
  return (
    <span className="flex flex-col">
      <span>{title}</span>
      <span className="font-normal text-text-secondary">
        {projectName} · {status}
      </span>
    </span>
  );
}

/**
 * Scrolls a row into view in the sidebar's own scroller when it becomes the one
 * on screen. scrollIntoView also scrolls every clipped ancestor, which pushes the
 * sidebar's header and the window's title bar out of view.
 */
function useRevealed(selected: boolean) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const row = ref.current;
    if (!selected || !row) return;
    const scroller = row.closest<HTMLElement>('[data-sidebar-scroller]');
    if (!scroller) return;
    const rowBox = row.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (rowBox.top < box.top) scroller.scrollTop -= box.top - rowBox.top;
    else if (rowBox.bottom > box.bottom) scroller.scrollTop += rowBox.bottom - box.bottom;
  }, [selected]);
  return ref;
}

interface RowProps {
  icon: ReactNode;
  title: string;
  tooltip: ReactNode;
  bright: boolean;
  /** Set in weight too, so an unread row stands apart from the one on screen. */
  unread?: boolean;
  selected?: boolean;
  mono?: boolean;
  detail?: string | null;
  trailing?: ReactNode;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Swaps the title for a field, prefilled, until committed or cancelled. */
  rename?: Rename;
  ptyId?: string;
}

export interface Rename {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function RenameField({ initial, onCommit, onCancel }: Rename) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    if (value && value.trim() && value.trim() !== initial) onCommit(value.trim());
    else onCancel();
  };
  return (
    <input
      autoFocus
      defaultValue={initial}
      aria-label="Name"
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish(null);
      }}
      className="flex-1 min-w-0 bg-transparent border-0 border-b border-accent p-0 text-[13px] text-text-primary outline-none"
    />
  );
}

export function SidebarRow({
  icon,
  title,
  tooltip,
  bright,
  unread = false,
  selected = false,
  mono,
  detail,
  trailing,
  onClick,
  onContextMenu,
  rename,
  ptyId,
}: RowProps) {
  const ref = useRevealed(selected);
  // The click is taken here rather than on the button so the icon, which has a
  // tooltip of its own, opens the row too; the button's click bubbles to it.
  return (
    <div
      className={`${ROW} ${selected ? ROW_SELECTED : ROW_IDLE} cursor-default select-none`}
      data-sidebar-row
      data-selected={selected || undefined}
      data-pty-id={ptyId}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">{icon}</span>
      {rename ? (
        <RenameField {...rename} />
      ) : (
        <Tooltip text={tooltip} placement="right" delay={500}>
          {(tipRef, tipProps) => (
            <button
              ref={(node) => {
                ref.current = node;
                tipRef(node);
              }}
              {...tipProps}
              type="button"
              className="flex-1 min-w-0 h-full flex items-center gap-2 bg-transparent border-none p-0 text-left outline-none"
              aria-current={selected ? 'true' : undefined}
              data-bright={bright ? 'true' : undefined}
            >
              <span
                className={`flex-1 min-w-0 truncate ${mono ? 'font-mono text-[11.5px]' : ''}`}
                style={{ color: bright ? 'var(--color-text-primary)' : DIM, fontWeight: unread ? 600 : undefined }}
              >
                {title}
              </span>
              {detail && <span className="shrink-0 font-mono text-[10.5px] text-text-tertiary">{detail}</span>}
              {trailing}
            </button>
          )}
        </Tooltip>
      )}
    </div>
  );
}

function StatusSlot({ display }: { display: TerminalDisplayState }) {
  const unread = useWantsYou(display.ptyId);
  return (
    <span className="w-3.5 flex items-center justify-center shrink-0">
      <StatusGlyph status={display.status} sandboxProvider={display.sandboxProvider} unread={unread} />
    </span>
  );
}

interface TerminalRowProps {
  ptyId: string;
  title: (display: TerminalDisplayState) => string;
  icon: ReactNode;
  mono?: boolean;
  detail?: string | null | ((display: TerminalDisplayState) => string | null);
  shown: string | undefined;
  selected: boolean;
  now: number;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  rename?: Rename;
}

function TerminalRow({
  ptyId,
  title,
  icon,
  mono,
  detail,
  shown,
  selected,
  now,
  onClick,
  onContextMenu,
  rename,
}: TerminalRowProps) {
  const display = useTerminalStore((s) => s.displayStates[ptyId]);
  const unread = useWantsYou(ptyId);
  const projectName = useProjectName(display?.projectPath ?? '');
  if (!display) return null;
  const text = title(display);
  return (
    <SidebarRow
      ptyId={ptyId}
      icon={icon}
      title={text}
      mono={mono}
      tooltip={rowTooltip(text, projectName, statusPhrase(display, now))}
      bright={unread || ptyId === shown}
      unread={unread}
      selected={selected}
      detail={typeof detail === 'function' ? detail(display) : detail}
      trailing={<StatusSlot display={display} />}
      onClick={onClick}
      onContextMenu={onContextMenu}
      rename={rename}
    />
  );
}

type MenuAt = { x: number; y: number; ptyId: string | null };

function useRowMenu(): [MenuAt | null, (ptyId: string | null) => (e: React.MouseEvent) => void, () => void] {
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const open = (ptyId: string | null) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, ptyId });
  };
  return [menu, open, () => setMenu(null)];
}

function renameTask(projectPath: string, taskNumber: number, name: string): void {
  void window.api.task.setName(projectPath, taskNumber, name).then(() => loadTasks(projectPath));
}

/**
 * A row's place in its group, `at`, and what a plain click on it does. `pick`
 * wraps that click so a modifier adds the row to the stack on screen instead.
 */
type Pick = (at: number, alone: () => void) => (e: React.MouseEvent) => void;
/** Likewise for right-click: a row of a stack of several gets the menu for all of it. */
type RowMenu = (at: number, own: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => void;

interface PlacedRowProps {
  /** Under a tag a row names its project, and a task is picked terminal by terminal. */
  underTag: boolean;
  shown: string | undefined;
  onScreen: string[];
  now: number;
  at: number;
  pick: Pick;
  rowMenu: RowMenu;
}

/** A task's rows, with the menu the board card and the terminal header give it. */
function TaskRows({ group, underTag, shown, onScreen, now, at, pick, rowMenu }: PlacedRowProps & { group: TaskGroup }) {
  const { projectPath, task } = group;
  const ownStack = stackOf({ ptyId: '', projectPath, taskId: group.taskId });
  const projectName = useProjectName(projectPath);
  const displays = useTerminalStore(useShallow((s) => group.ptyIds.map((id) => s.displayStates[id])));
  const asking = useAsking();
  const anyUnread = useTerminalStore((s) => group.ptyIds.some((id) => wantsYou(s, id, asking)));
  const sandboxProviders = useProjectConfig(projectPath)?.availableSandboxProviders ?? NO_BACKENDS;
  const github = useExperimentalStore((s) => s.flagsByProject[projectPath]?.github ?? false);
  const linear = useExperimentalStore((s) => s.flagsByProject[projectPath]?.linear ?? false);
  const [menu, openMenu, closeMenu] = useRowMenu();
  const [renaming, setRenaming] = useState<'task' | string | null>(null);
  const [branchingFrom, setBranchingFrom] = useState(false);

  const taskTitle = task?.name || displays[0]?.label || 'Untitled';
  const icon = task ? <StageIcon status={task.status} /> : <Icon name="terminal-window" className="w-3.5 h-3.5" />;
  const detail = underTag ? projectName : null;

  const menuItems = (ptyId: string | null): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = task
      ? taskEntries({
          projectPath,
          task,
          sandboxProviders,
          terminals: displays.filter((d): d is TerminalDisplayState => d !== undefined && !d.isLoading),
          trackers: { github, linear },
          openTerminal: (provider) => void openTaskTerminal(projectPath, task, provider),
          showTerminal: (id) => void focusTerminal(id),
          branchFrom: () => setBranchingFrom(true),
          rename: () => setRenaming('task'),
        })
      : [];
    if (ptyId) {
      items.push({
        label: task ? 'Rename terminal' : 'Rename',
        icon: 'pencil-simple',
        onClick: () => setRenaming(ptyId),
      });
    }
    return items;
  };

  const taskRename: Rename | undefined =
    renaming === 'task' && task
      ? {
          initial: task.name ?? '',
          onCommit: (name) => renameTask(projectPath, task.taskNumber, name),
          onCancel: () => setRenaming(null),
        }
      : undefined;
  const terminalRename = (ptyId: string): Rename | undefined =>
    renaming === ptyId
      ? {
          initial: useTerminalStore.getState().displayStates[ptyId]?.label ?? '',
          onCommit: (label) => renameTerminal(ptyId, label),
          onCancel: () => setRenaming(null),
        }
      : undefined;
  // Committing leaves the field to the store update that follows; the flag clears either way.
  const commitAndClose = (rename: Rename | undefined): Rename | undefined =>
    rename && {
      ...rename,
      onCommit: (value) => {
        rename.onCommit(value);
        setRenaming(null);
      },
    };

  const single = group.ptyIds.length === 1;
  const front = displays[0];

  return (
    <>
      {!front && task ? (
        <SidebarRow
          icon={icon}
          title={taskTitle}
          tooltip={rowTooltip(taskTitle, projectName, 'No terminal open')}
          bright={false}
          trailing={<IdleMark />}
          onClick={pick(at, () => void openTaskTerminal(projectPath, task, undefined, ownStack))}
          onContextMenu={rowMenu(at, openMenu(null))}
          rename={commitAndClose(taskRename)}
        />
      ) : single ? (
        <TerminalRow
          ptyId={group.ptyIds[0]}
          title={() => taskTitle}
          icon={icon}
          detail={detail}
          shown={shown}
          selected={onScreen.includes(group.ptyIds[0])}
          now={now}
          onClick={pick(at, () => void focusTerminal(group.ptyIds[0], { stack: ownStack }))}
          onContextMenu={rowMenu(at, openMenu(group.ptyIds[0]))}
          rename={commitAndClose(taskRename ?? terminalRename(group.ptyIds[0]))}
        />
      ) : (
        <>
          {front && (
            <SidebarRow
              icon={icon}
              title={taskTitle}
              tooltip={rowTooltip(taskTitle, projectName, statusPhrase(front, now))}
              bright={anyUnread}
              unread={anyUnread}
              selected={group.ptyIds.every((id) => onScreen.includes(id))}
              detail={detail}
              onClick={pick(at, () => {
                const { order } = useTerminalStore.getState();
                const latest = order.find((id) => group.ptyIds.includes(id)) ?? group.ptyIds[0];
                void focusTerminal(latest, { stack: ownStack });
              })}
              onContextMenu={rowMenu(at, openMenu(null))}
              rename={commitAndClose(taskRename)}
            />
          )}
          {group.ptyIds.map((ptyId, i) => (
            <TerminalRow
              key={ptyId}
              ptyId={ptyId}
              title={(d) => d.lastOscTitle || d.label}
              mono
              icon={<span className="font-mono text-xs opacity-45">└</span>}
              shown={shown}
              selected={onScreen.includes(ptyId)}
              now={now}
              onClick={pick(at + 1 + i, () => void focusTerminal(ptyId, { stack: stackFrom([terminalUnit(ptyId)]) }))}
              onContextMenu={rowMenu(at + 1 + i, openMenu(ptyId))}
              rename={commitAndClose(terminalRename(ptyId))}
            />
          ))}
        </>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.ptyId)} onClose={closeMenu} />}
      {branchingFrom && task && (
        <BranchFromTaskDialog
          projectPath={projectPath}
          parentTask={task}
          onClose={(created) => {
            setBranchingFrom(false);
            if (created) loadTasks(projectPath);
          }}
        />
      )}
    </>
  );
}

/** A project's to-dos with no terminal open, in board order; one that has a terminal is listed as a task. */
function waitingTodos(projectTasks: TaskWithWorkspace[], listed: TaskGroup[]): TaskWithWorkspace[] {
  const open = new Set(listed.map((group) => group.taskId));
  return projectTasks
    .filter((task) => task.status === 'todo' && !open.has(task.taskNumber))
    .sort((a, b) => a.order - b.order);
}

/** Past this many to-dos the menu gains a field to filter them. */
const FILTER_FROM = 8;

/** One row for a project's waiting to-dos, opening a menu that starts the one picked. */
function TodoMenuRow({ projectPath, todos }: { projectPath: string; todos: TaskWithWorkspace[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = todos.filter((task) => words.every((word) => (task.name ?? '').toLowerCase().includes(word)));

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const start = (task: TaskWithWorkspace) => {
    close();
    startTodo(projectPath, task);
  };
  const walkRows = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[Math.max(0, Math.min(rows.length - 1, event.key === 'ArrowDown' ? at + 1 : at - 1))]?.focus();
  };

  return (
    <MenuPopover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      placement="bottom-start"
      className="w-64 max-h-[22rem]"
      header={
        todos.length > FILTER_FROM && (
          <label className="flex items-center gap-2 h-8 px-2.5 rounded-[7px] bg-ink/[0.05] focus-within:bg-ink/[0.08] transition-colors duration-150">
            <Icon name="magnifying-glass" className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
            <input
              autoFocus
              aria-label="Filter to-dos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Escape clears the query first, and only then reaches the menu's own close.
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                }
                if (e.key === 'Enter' && shown.length > 0) start(shown[0]);
                walkRows(e);
              }}
              placeholder="Filter"
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary"
            />
          </label>
        )
      }
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          className={`${ROW} ${open ? 'bg-ink/[0.06]' : ROW_IDLE} cursor-default select-none`}
          onClick={() => (open ? close() : setOpen(true))}
          onKeyDown={(e) => open && walkRows(e)}
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
      )}
    >
      <div ref={listRef} onKeyDown={walkRows}>
        {shown.map((task) => (
          <MenuItem
            key={task.taskNumber}
            icon={<StageGlyph status="todo" />}
            label={task.name || 'Untitled'}
            onClick={() => start(task)}
          />
        ))}
        {shown.length === 0 && <div className="px-2.5 py-1.5 text-sm text-text-tertiary">No match</div>}
      </div>
    </MenuPopover>
  );
}

function NewTaskRow({ projectPath }: { projectPath: string }) {
  return (
    <button
      type="button"
      className={`${ROW} ${ROW_IDLE} text-text-tertiary hover:text-text-secondary`}
      onClick={() => openTaskSheet(projectPath)}
    >
      <Icon name="plus" className="w-3.5 h-3.5" />
      <span className="truncate">New task</span>
    </button>
  );
}

/** Where a task with no terminal open would show its status dot. */
function IdleMark() {
  return (
    <span aria-label="No terminal open" className="w-3.5 flex items-center justify-center shrink-0 text-text-tertiary">
      <Icon name="moon" className="w-3 h-3" />
    </span>
  );
}

function ShellRow({ ptyId, underTag, shown, onScreen, now, at, pick, rowMenu }: PlacedRowProps & { ptyId: string }) {
  const [menu, openMenu, closeMenu] = useRowMenu();
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <TerminalRow
        ptyId={ptyId}
        title={(d) => d.label || 'Shell'}
        icon={<Icon name="terminal-window" className="w-3.5 h-3.5 text-text-tertiary" />}
        detail={underTag ? (d) => projectNameOf(useAppStore.getState().projects, d.projectPath) : undefined}
        shown={shown}
        selected={onScreen.includes(ptyId)}
        now={now}
        onClick={pick(
          at,
          () => void focusTerminal(ptyId, { stack: stackOf({ ptyId, projectPath: '', taskId: null }) }),
        )}
        onContextMenu={rowMenu(at, openMenu(ptyId))}
        rename={
          renaming
            ? {
                initial: useTerminalStore.getState().displayStates[ptyId]?.label ?? '',
                onCommit: (label) => {
                  renameTerminal(ptyId, label);
                  setRenaming(false);
                },
                onCancel: () => setRenaming(false),
              }
            : undefined
        }
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: 'Rename', icon: 'pencil-simple', onClick: () => setRenaming(true) }]}
          onClose={closeMenu}
        />
      )}
    </>
  );
}

/** A group's tasks in board order, then its shells. */
export function GroupRows({
  ptyIds,
  underTag = false,
  projectOrder,
  idleIn,
}: {
  ptyIds: string[];
  underTag?: boolean;
  projectOrder?: string[];
  /** The project whose in-progress and in-review tasks stay listed with no terminal open. */
  idleIn?: string;
}) {
  const displays = useTerminalStore((s) => s.displayStates);
  const tasksByProject = useAppStore((s) => s.taskCacheByProject);
  const shown = useShownPtyId();
  const onScreen = useOnScreen();
  const now = useNow();
  const anchor = useRef<number | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; ptyIds: string[] } | null>(null);
  const [tagging, setTagging] = useState<{ x: number; y: number; ptyIds: string[] } | null>(null);
  const grouped = useMemo(
    () => groupByTask(ptyIds, displays, tasksByProject, projectOrder, idleIn),
    [ptyIds, displays, tasksByProject, projectOrder, idleIn],
  );
  const { tasks, shells } = grouped;

  const todos = idleIn ? waitingTodos(tasksByProject[idleIn] ?? [], tasks) : [];
  const todoRow = idleIn && todos.length > 0 && <TodoMenuRow projectPath={idleIn} todos={todos} />;

  if (idleIn && tasks.length === 0 && shells.length === 0) {
    return (
      <>
        {todoRow}
        <NewTaskRow projectPath={idleIn} />
      </>
    );
  }

  // Every row in the order drawn, each with the terminals clicking it picks.
  const rows: { ptyIds: string[]; idle?: TaskGroup }[] = [];
  const starts = tasks.map((group) => {
    const start = rows.length;
    if (group.ptyIds.length === 0) rows.push({ ptyIds: [], idle: group });
    else rows.push({ ptyIds: group.ptyIds });
    if (group.ptyIds.length > 1) rows.push(...group.ptyIds.map((id) => ({ ptyIds: [id] })));
    return start;
  });
  const shellStart = rows.length;
  rows.push(...shells.map((id) => ({ ptyIds: [id] })));

  const pick: Pick = (at, alone) => (e) => {
    const toggling = isModKey(e);
    const ranging = e.shiftKey && anchor.current !== null;
    const members = onScreenHere(ptyIds);
    if ((!toggling && !ranging) || members.length === 0) {
      anchor.current = at;
      alone();
      return;
    }
    const row = rows[at];
    const next = new Set(members);
    let picked = [row];
    if (ranging) {
      const [from, to] = [anchor.current!, at].sort((a, b) => a - b);
      picked = rows.slice(from, to + 1);
      for (const id of picked.flatMap((r) => r.ptyIds)) next.add(id);
    } else {
      anchor.current = at;
      const leaving = row.ptyIds.length > 0 && row.ptyIds.every((id) => next.has(id));
      for (const id of row.ptyIds) {
        if (leaving) next.delete(id);
        else next.add(id);
      }
    }
    // Picking a task with nothing open resumes it, as clicking it alone does.
    const waking = picked.flatMap((r) => (r.idle?.task ? [{ ...r.idle, task: r.idle.task }] : []));
    const units = unitsFor(next, grouped, !underTag);
    for (const idle of waking) units.push(stackOf({ ptyId: '', projectPath: idle.projectPath, taskId: idle.taskId }));
    if (units.length === 0) return;
    const stack = stackFrom(units);
    void Promise.all(waking.map((idle) => openTaskTerminal(idle.projectPath, idle.task, undefined, stack))).then(() =>
      showInListOrder(stack, projectOrder, idleIn),
    );
  };

  const rowMenu: RowMenu = (at, own) => (e) => {
    const members = onScreenHere(ptyIds);
    const { selection } = useAppStore.getState();
    const front = useTerminalStore.getState().displayStates[members[0]];
    const many = front !== undefined && selection.kind === 'terminal' && stackOf(front) !== selection.stack;
    if (!many || !rows[at].ptyIds.some((id) => members.includes(id))) return own(e);
    e.preventDefault();
    setSelectionMenu({ x: e.clientX, y: e.clientY, ptyIds: members });
  };

  const placed = { underTag, shown, onScreen, now, pick, rowMenu };
  return (
    <>
      {todoRow}
      {tasks.map((group, i) => (
        <TaskRows key={group.key} group={group} at={starts[i]} {...placed} />
      ))}
      {shells.map((ptyId, i) => (
        <ShellRow key={ptyId} ptyId={ptyId} at={shellStart + i} {...placed} />
      ))}
      {selectionMenu && (
        <ContextMenu
          x={selectionMenu.x}
          y={selectionMenu.y}
          items={selectionEntries(selectionMenu.ptyIds, () => setTagging(selectionMenu))}
          onClose={() => setSelectionMenu(null)}
        />
      )}
      {tagging && <TagPrompt {...tagging} onClose={() => setTagging(null)} />}
    </>
  );
}

/**
 * The part of the stack on screen that is in this group. A task's stack can
 * hold terminals listed elsewhere, under another tag; picking more here leaves
 * those behind, since a stack stays in one group.
 */
/**
 * Shows `stack` with its cards in the order the sidebar lists them. The front
 * card sits lowest, so it is the last one listed and the rest peek out above it
 * the way the list runs; ⌘W then walks up the list.
 */
export function showInListOrder(stack: string, projectOrder?: string[], idleIn?: string): void {
  const terminals = useTerminalStore.getState();
  const members = new Set(stackMembers(terminals, stack));
  // In the order the sidebar's groups are fed, so a task's terminals line up with its rows.
  const listedIds = Object.values(terminals.terminalsByProject)
    .flat()
    .filter((id) => members.has(id));
  const tasks = useAppStore.getState().taskCacheByProject;
  const grouped = groupByTask(listedIds, terminals.displayStates, tasks, projectOrder, idleIn);
  const frontFirst = listedOrder(grouped).reverse();
  if (frontFirst.length === 0) return;
  useTerminalStore.getState().restoreOrder(frontFirst);
  void focusTerminal(frontFirst[0], { stack });
}

function onScreenHere(ptyIds: string[]): string[] {
  const { selection } = useAppStore.getState();
  if (selection.kind !== 'terminal') return [];
  return stackMembers(useTerminalStore.getState(), selection.stack).filter((id) => ptyIds.includes(id));
}

/** One per terminal that is working or finished unseen, for a group folded away. */
export function GroupDots({ ptyIds }: { ptyIds: string[] }) {
  const asking = useAsking();
  const dots = useTerminalStore(
    useShallow((s) =>
      ptyIds.flatMap((id) => {
        // Before thinking: an agent waiting on an ask is still working, as far as its status says.
        if (wantsYou(s, id, asking)) return ['unread'];
        return s.displayStates[id]?.status === 'thinking' ? ['thinking'] : [];
      }),
    ),
  );
  if (dots.length === 0) return null;
  return (
    <span className="flex items-center gap-1 shrink-0" data-testid="group-dots">
      {dots.map((dot, i) => (
        <StatusGlyph key={i} status={dot === 'thinking' ? 'thinking' : 'ready'} unread={dot === 'unread'} />
      ))}
    </span>
  );
}

export function useGroupCollapsed(key: string): [boolean, () => void] {
  const collapsed = useUIStore((s) => !!s.collapsedGroups[key]);
  return [collapsed, () => useUIStore.getState().toggleGroupCollapsed(key)];
}
