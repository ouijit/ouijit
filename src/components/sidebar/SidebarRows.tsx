import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { isUnread, stackMembers, useTerminalStore, viewedPtyId } from '../../stores/terminalStore';
import type { TerminalDisplayState } from '../../stores/terminalDisplay';
import type { Project } from '../../types';
import { useUIStore } from '../../stores/uiStore';
import { filesInDiff } from '../../diffSource';
import { focusTerminal, openTaskTerminal } from '../navigation';
import { ContextMenu } from '../ui/ContextMenu';
import { Icon } from '../terminal/Icon';
import { StatusGlyph } from '../terminal/StatusDot';
import { Tooltip } from '../ui/Tooltip';
import { StageIcon } from './StageIcon';
import { formatSince, groupByTask, type TaskGroup } from './sidebarTree';

export const ROW =
  'w-full h-7 flex items-center gap-2 pl-2 pr-2.5 rounded-[7px] text-[13px] text-left whitespace-nowrap transition-colors duration-100';
export const ROW_IDLE = 'hover:bg-ink/5';
export const ROW_SELECTED = 'bg-ink/10';
const DIM = 'color-mix(in srgb, var(--color-text-primary) 62%, transparent)';

/** Ticks often enough for "4m" to stay true. */
export function useNow(): number {
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

export function homeRelative(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}

function projectNameOf(projects: Project[], projectPath: string): string {
  return projects.find((p) => p.path === projectPath)?.name ?? homeRelative(projectPath);
}

export function useProjectName(projectPath: string): string {
  return useAppStore((s) => projectNameOf(s.projects, projectPath));
}

function diffSummary(display: TerminalDisplayState | undefined): string | null {
  if (!display?.gitFileStatus) return null;
  const files = filesInDiff(display.gitFileStatus);
  const insertions = files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
  return insertions || deletions ? `+${insertions} −${deletions}` : null;
}

function statusPhrase(display: TerminalDisplayState, now: number): string {
  const since = formatSince(now - display.statusSince);
  const duration = since === 'now' ? 'a moment' : since;
  return `${display.status === 'thinking' ? 'Working' : 'Ready'} for ${duration}`;
}

export function rowTooltip(title: string, projectName: string, display: TerminalDisplayState, now: number): string {
  return `${title} · ${projectName} · ${statusPhrase(display, now)}`;
}

/** Scrolls a row into view when it becomes the one on screen. */
function useRevealed(selected: boolean) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // Optional call: jsdom doesn't implement scrollIntoView.
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return ref;
}

interface RowProps {
  icon: ReactNode;
  title: string;
  tooltip: string;
  bright: boolean;
  selected?: boolean;
  mono?: boolean;
  detail?: string | null;
  trailing?: ReactNode;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  ptyId?: string;
}

export function SidebarRow({
  icon,
  title,
  tooltip,
  bright,
  selected = false,
  mono,
  detail,
  trailing,
  onClick,
  onContextMenu,
  ptyId,
}: RowProps) {
  const ref = useRevealed(selected);
  // The click is taken here rather than on the button so the icon, which has a
  // tooltip of its own, opens the row too; the button's click bubbles to it.
  return (
    <div
      className={`${ROW} ${selected ? ROW_SELECTED : ROW_IDLE} cursor-default`}
      data-sidebar-row
      data-pty-id={ptyId}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">{icon}</span>
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
              style={{ color: bright ? 'var(--color-text-primary)' : DIM }}
            >
              {title}
            </span>
            {detail && <span className="shrink-0 font-mono text-[10.5px] text-text-tertiary">{detail}</span>}
            {trailing}
          </button>
        )}
      </Tooltip>
    </div>
  );
}

function StatusSlot({ display }: { display: TerminalDisplayState }) {
  return (
    <span className="w-3.5 flex items-center justify-center shrink-0">
      <StatusGlyph status={display.status} sandboxProvider={display.sandboxProvider} />
    </span>
  );
}

/** Whether a terminal's title reads bright: it is on screen, or it finished while you were elsewhere. */
function useBright(ptyId: string, shown: string | undefined): boolean {
  return useTerminalStore((s) => {
    const display = s.displayStates[ptyId];
    return ptyId === shown || (display !== undefined && isUnread(display, viewedPtyId(s)));
  });
}

interface TerminalRowProps {
  ptyId: string;
  title: (display: TerminalDisplayState) => string;
  icon: ReactNode;
  mono?: boolean;
  detail?: string | null | ((display: TerminalDisplayState) => string | null);
  shown: string | undefined;
  now: number;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function TerminalRow({ ptyId, title, icon, mono, detail, shown, now, onContextMenu }: TerminalRowProps) {
  const display = useTerminalStore((s) => s.displayStates[ptyId]);
  const bright = useBright(ptyId, shown);
  const projectName = useProjectName(display?.projectPath ?? '');
  if (!display) return null;
  const text = title(display);
  return (
    <SidebarRow
      ptyId={ptyId}
      icon={icon}
      title={text}
      mono={mono}
      tooltip={rowTooltip(text, projectName, display, now)}
      bright={bright}
      selected={ptyId === shown}
      detail={typeof detail === 'function' ? detail(display) : detail}
      trailing={<StatusSlot display={display} />}
      onClick={() => void focusTerminal(ptyId)}
      onContextMenu={onContextMenu}
    />
  );
}

/** What the slot after a task's title shows: its diff, or under a tag, which project it is in. */
export type RowDetail = 'diff' | 'project';

function TaskRows({
  group,
  detail,
  shown,
  now,
}: {
  group: TaskGroup;
  detail: RowDetail;
  shown: string | undefined;
  now: number;
}) {
  const projectName = useProjectName(group.projectPath);
  const displays = useTerminalStore(useShallow((s) => group.ptyIds.map((id) => s.displayStates[id])));
  const anyUnread = useTerminalStore((s) => {
    const viewed = viewedPtyId(s);
    return group.ptyIds.some((id) => {
      const display = s.displayStates[id];
      return display !== undefined && isUnread(display, viewed);
    });
  });
  const taskTitle = group.task?.name || displays[0]?.label || 'Untitled';
  const icon = group.task ? <StageIcon status={group.task.status} /> : <Icon name="terminal" className="w-3.5 h-3.5" />;
  const diff = detail === 'project' ? projectName : (displays.map(diffSummary).find(Boolean) ?? null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { task } = group;
  const openMenu = task
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }
    : undefined;
  const menuView = menu && task && (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={[{ label: 'New terminal', onClick: () => void openTaskTerminal(group.projectPath, task) }]}
      onClose={() => setMenu(null)}
    />
  );

  if (group.ptyIds.length === 1) {
    return (
      <>
        <TerminalRow
          ptyId={group.ptyIds[0]}
          title={() => taskTitle}
          icon={icon}
          detail={diff}
          shown={shown}
          now={now}
          onContextMenu={openMenu}
        />
        {menuView}
      </>
    );
  }

  const front = displays[0];
  return (
    <>
      {menuView}
      {front && (
        <SidebarRow
          icon={icon}
          title={taskTitle}
          tooltip={rowTooltip(taskTitle, projectName, front, now)}
          bright={anyUnread}
          detail={diff}
          onClick={() => {
            const { order } = useTerminalStore.getState();
            void focusTerminal(order.find((id) => group.ptyIds.includes(id)) ?? group.ptyIds[0]);
          }}
          onContextMenu={openMenu}
        />
      )}
      {group.ptyIds.map((ptyId) => (
        <TerminalRow
          key={ptyId}
          ptyId={ptyId}
          title={(d) => d.lastOscTitle || d.label}
          mono
          icon={<span className="font-mono text-xs opacity-45">└</span>}
          shown={shown}
          now={now}
          onContextMenu={openMenu}
        />
      ))}
    </>
  );
}

/** A group's tasks in board order, then its shells. */
export function GroupRows({
  ptyIds,
  detail,
  projectOrder,
}: {
  ptyIds: string[];
  detail: RowDetail;
  projectOrder?: string[];
}) {
  const displays = useTerminalStore((s) => s.displayStates);
  const tasksByProject = useAppStore((s) => s.taskCacheByProject);
  const shown = useShownPtyId();
  const now = useNow();
  const { tasks, shells } = useMemo(
    () => groupByTask(ptyIds, displays, tasksByProject, projectOrder),
    [ptyIds, displays, tasksByProject, projectOrder],
  );

  return (
    <>
      {tasks.map((group) => (
        <TaskRows key={group.key} group={group} detail={detail} shown={shown} now={now} />
      ))}
      {shells.map((ptyId) => (
        <TerminalRow
          key={ptyId}
          ptyId={ptyId}
          title={(d) => d.label || 'Shell'}
          icon={<Icon name="terminal" className="w-3.5 h-3.5 text-text-tertiary" />}
          detail={
            detail === 'project' ? (d) => projectNameOf(useAppStore.getState().projects, d.projectPath) : undefined
          }
          shown={shown}
          now={now}
        />
      ))}
    </>
  );
}

/** One per terminal that is working or finished unseen, for a group folded away. */
export function GroupDots({ ptyIds }: { ptyIds: string[] }) {
  const statuses = useTerminalStore(
    useShallow((s) => {
      const viewed = viewedPtyId(s);
      return ptyIds.flatMap((id) => {
        const display = s.displayStates[id];
        return display && (display.status === 'thinking' || isUnread(display, viewed)) ? [display.status] : [];
      });
    }),
  );
  if (statuses.length === 0) return null;
  return (
    <span className="flex items-center gap-1 shrink-0" data-testid="group-dots">
      {statuses.map((status, i) => (
        <StatusGlyph key={i} status={status} />
      ))}
    </span>
  );
}

export function useGroupCollapsed(key: string): [boolean, () => void] {
  const collapsed = useUIStore((s) => !!s.collapsedGroups[key]);
  return [collapsed, () => useUIStore.getState().toggleGroupCollapsed(key)];
}
