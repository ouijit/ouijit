import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useShallow } from 'zustand/react/shallow';
import { ProjectTile } from './ProjectTile';
import type { CloneJob, Project } from '../types';
import { useAppStore, selectCloneJob, type ProjectPage } from '../stores/appStore';
import { useExperimentalStore, useProjectFlags } from '../stores/experimentalStore';
import {
  projectUnit,
  stackFrom,
  tagUnit,
  terminalUnit,
  useTerminalStore,
  type TerminalDisplayState,
} from '../stores/terminalStore';
import {
  useUIStore,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarGroupMode,
} from '../stores/uiStore';
import { ResizeHandle } from './common/ResizeHandle';
import { refreshTerminalsGitStatus } from './terminal/terminalReact';
import { Icon } from './terminal/Icon';
import { Tooltip } from './ui/Tooltip';
import { openProject, openProjectPage, openShell, openTaskTerminal } from './navigation';
import { isModKey } from '../utils/modKey';
import { openTaskSheet } from '../utils/openTaskComposer';
import { ContextMenu, type ContextMenuEntry, type ContextMenuItem } from './ui/ContextMenu';
import { PAGE_TITLES } from './TitleBarReact';
import { groupByTag, groupByTask } from './sidebar/sidebarTree';
import {
  GroupDots,
  GroupRows,
  ROW_IDLE,
  ROW_SELECTED,
  homeRelative,
  useGroupCollapsed,
  showInListOrder,
  useShownPtyId,
} from './sidebar/SidebarRows';

const GIT_REFRESH_INTERVAL = 120_000;

function groupKeysOf(display: TerminalDisplayState): string[] {
  const tags = display.tags.length > 0 ? display.tags.map((tag) => `tag:${tag.toLowerCase()}`) : ['tag:'];
  return [display.projectPath, ...tags];
}

function isListed(display: TerminalDisplayState, mode: SidebarGroupMode, collapsed: Record<string, true>): boolean {
  const keys = groupKeysOf(display);
  return mode === 'project' ? !collapsed[keys[0]] : keys.slice(1).some((key) => !collapsed[key]);
}

/**
 * Keeps the diff summaries on the task rows current, one terminal per task
 * worktree, more slowly than the terminals on screen are refreshed.
 */
function useListedGitStatus(): void {
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      const ui = useUIStore.getState();
      if (!ui.sidebarShown && !ui.sidebarRevealed) return;
      const { order, displayStates } = useTerminalStore.getState();
      const seen = new Set<string>();
      const ptyIds = order.filter((id) => {
        const display = displayStates[id];
        if (!display || display.taskId == null || display.isLoading) return false;
        if (!isListed(display, ui.sidebarGroupMode, ui.collapsedGroups)) return false;
        const task = `${display.projectPath}#${display.taskId}`;
        if (seen.has(task)) return false;
        seen.add(task);
        return true;
      });
      void refreshTerminalsGitStatus(ptyIds);
    };
    const start = () => {
      if (interval == null && !document.hidden) interval = setInterval(refresh, GIT_REFRESH_INTERVAL);
    };
    const stop = () => {
      if (interval != null) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []);
}

function useRevealShown(): void {
  const shown = useShownPtyId();
  useEffect(() => {
    const display = shown ? useTerminalStore.getState().displayStates[shown] : undefined;
    if (display) useUIStore.getState().expandGroups(groupKeysOf(display));
  }, [shown]);
}

interface SidebarProps {
  onAddProject: () => void;
  onCloneSelect: (projectPath: string) => void;
}

export function Sidebar({ onAddProject, onCloneSelect }: SidebarProps) {
  const shown = useUIStore((s) => s.sidebarShown);
  const revealed = useUIStore((s) => s.sidebarRevealed);
  const width = useUIStore((s) => s.sidebarWidth);
  const appSettingsOpen = useAppStore((s) => s.selection.kind === 'app-settings');
  const open = shown || revealed;
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useListedGitStatus();
  useRevealShown();

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }, [width]);

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-offset', open ? 'var(--sidebar-width)' : '0px');
  }, [open]);

  // Everything that follows the sidebar's edge eases after it; while dragged it should track the pointer.
  const startResize = () => {
    const root = document.documentElement;
    root.classList.add('sidebar-resizing');
    document.addEventListener('mouseup', () => root.classList.remove('sidebar-resizing'), { once: true });
  };

  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const hideRevealed = () => {
    if (useUIStore.getState().sidebarShown) return;
    hideTimer.current = setTimeout(() => useUIStore.getState().setSidebarRevealed(false), 300);
  };

  return (
    <>
      {!open && (
        <div
          className="fixed top-0 bottom-0 left-0 z-[10000]"
          style={{ width: 24 }}
          onMouseEnter={(e) => {
            if (e.buttons !== 0) return;
            showTimer.current = setTimeout(() => useUIStore.getState().setSidebarRevealed(true), 120);
          }}
          onMouseLeave={clearTimers}
        />
      )}

      <aside
        aria-label="Sidebar"
        className="fixed top-0 bottom-0 left-0 z-[10001] overflow-hidden"
        style={
          {
            '--sidebar-bg': 'color-mix(in srgb, var(--color-surface) 22%, var(--color-background))',
            width: open ? 'var(--sidebar-width)' : 0,
            transition: 'width 200ms ease-out',
            background: 'var(--sidebar-bg)',
          } as React.CSSProperties
        }
        onMouseEnter={clearTimers}
        onMouseLeave={hideRevealed}
      >
        <div className="h-full flex flex-col" style={{ width: 'var(--sidebar-width)' }}>
          {/* Electron sizes drag regions by layout, not by what is clipped, so a
              collapsed sidebar would still claim this strip over the title bar. */}
          <div
            className={`h-[72px] shrink-0 flex items-center justify-end gap-0.5 px-2.5 ${open ? '[-webkit-app-region:drag]' : ''}`}
          >
            <SearchButton />
            <Tooltip text={shown ? 'Hide sidebar' : 'Keep sidebar open'} placement="bottom-end">
              <button
                type="button"
                aria-label={shown ? 'Hide sidebar' : 'Keep sidebar open'}
                className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-text-primary [-webkit-app-region:no-drag] [&>svg]:w-5 [&>svg]:h-5"
                onClick={() => useUIStore.getState().setSidebarShown(!shown)}
              >
                <Icon name="sidebar-simple" />
              </button>
            </Tooltip>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 pt-1 pb-4 flex flex-col [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TreeSection onCloneSelect={onCloneSelect} />
          </div>

          <div className="shrink-0 px-2.5 pt-2 pb-3 border-t border-separator">
            <FooterButton icon="plus" label="Add project" onClick={onAddProject} />
            <FooterButton
              icon="gear"
              label="Settings"
              selected={appSettingsOpen}
              onClick={() => useAppStore.getState().select({ kind: 'app-settings' })}
            />
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed top-0 bottom-0 z-[10002] flex"
          style={{ left: 'calc(var(--sidebar-width) - 1px)' }}
          onMouseDownCapture={startResize}
          onMouseEnter={clearTimers}
          onMouseLeave={hideRevealed}
        >
          <ResizeHandle
            width={width}
            onWidth={useUIStore.getState().setSidebarWidth}
            min={SIDEBAR_MIN_WIDTH}
            max={SIDEBAR_MAX_WIDTH}
            defaultWidth={SIDEBAR_DEFAULT_WIDTH}
            label="Resize sidebar"
          />
        </div>
      )}
    </>
  );
}

function SearchButton() {
  const paletteOpen = useUIStore((s) => s.paletteOpen);
  return (
    <Tooltip text="Search" placement="bottom-end">
      <button
        type="button"
        aria-label="Toggle search"
        aria-expanded={paletteOpen}
        className={`w-9 h-9 flex items-center justify-center rounded-[10px] transition-colors duration-150 hover:bg-background-secondary hover:text-text-primary [-webkit-app-region:no-drag] [&>svg]:w-5 [&>svg]:h-5 ${
          paletteOpen ? 'bg-background-secondary text-text-primary' : 'text-text-secondary'
        }`}
        onClick={() => useUIStore.getState().togglePalette()}
      >
        <Icon name="magnifying-glass" />
      </button>
    </Tooltip>
  );
}

function FooterButton({
  icon,
  label,
  selected = false,
  onClick,
}: {
  icon: string;
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`w-full h-7 flex items-center gap-2.5 pl-1.5 rounded-[7px] text-[13px] text-text-secondary hover:text-text-primary ${selected ? ROW_SELECTED : ROW_IDLE}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon name={icon} className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="h-[26px] shrink-0 flex items-center pl-2.5 pr-0.5 text-[11.5px] font-semibold text-text-secondary">
      {children}
    </div>
  );
}

// ── Projects and tags ────────────────────────────────────────────────

function TreeSection({ onCloneSelect }: { onCloneSelect: (projectPath: string) => void }) {
  const mode = useUIStore((s) => s.sidebarGroupMode);
  const setMode = useUIStore((s) => s.setSidebarGroupMode);
  const tab = (value: SidebarGroupMode, label: string) => (
    <button
      type="button"
      role="tab"
      data-mode={value}
      aria-selected={mode === value}
      tabIndex={mode === value ? 0 : -1}
      className={`h-full transition-colors duration-100 ${
        mode === value ? 'text-text-secondary' : 'text-text-tertiary hover:text-text-secondary'
      }`}
      onClick={() => setMode(value)}
    >
      {label}
    </button>
  );

  return (
    <section aria-label={mode === 'project' ? 'Projects' : 'Tags'} className="flex flex-col">
      <SectionHeading>
        <div
          role="tablist"
          aria-label="Group by"
          className="h-full flex gap-3"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const next = mode === 'project' ? 'tag' : 'project';
            setMode(next);
            e.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
          }}
        >
          {tab('project', 'Projects')}
          {tab('tag', 'Tags')}
        </div>
      </SectionHeading>
      {mode === 'project' ? <ProjectsTree onCloneSelect={onCloneSelect} /> : <TagsTree />}
    </section>
  );
}

function ProjectsTree({ onCloneSelect }: { onCloneSelect: (projectPath: string) => void }) {
  const projects = useAppStore((s) => s.projects);
  const cloningPaths = useAppStore(useShallow((s) => s.cloneJobs.map((job) => job.projectPath)));
  const unregistered = useTerminalStore(
    useShallow((s) => {
      const known = new Set([...projects.map((p) => p.path), ...cloningPaths]);
      const paths = new Set<string>();
      for (const id of s.order) {
        const path = s.displayStates[id]?.projectPath;
        if (path && !known.has(path)) paths.add(path);
      }
      return [...paths].sort();
    }),
  );

  const [orderedPaths, setOrderedPaths] = useState<string[]>([]);
  useEffect(() => setOrderedPaths(projects.map((p) => p.path)), [projects]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.path, p])), [projects]);

  const loadedFlags = useExperimentalStore((s) => s.flagsByProject);
  useEffect(() => {
    for (const project of projects) {
      if (!loadedFlags[project.path]) void useExperimentalStore.getState().loadFor(project.path);
    }
  }, [projects, loadedFlags]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const next = arrayMove(
        orderedPaths,
        orderedPaths.indexOf(active.id as string),
        orderedPaths.indexOf(over.id as string),
      );
      setOrderedPaths(next);
      void window.api.reorderProjects(next);
    },
    [orderedPaths],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedPaths} strategy={verticalListSortingStrategy}>
          {orderedPaths.map((path) => {
            const project = projectMap.get(path);
            return project ? <ProjectGroup key={path} project={project} /> : null;
          })}
        </SortableContext>
      </DndContext>
      {cloningPaths.map((path) => (
        <CloneRow key={path} projectPath={path} onSelect={() => onCloneSelect(path)} />
      ))}
      {unregistered.map((path) => (
        <PathGroup key={path} path={path} />
      ))}
    </div>
  );
}

/** In the order they were opened: the sidebar holds still while you move between terminals. */
function useTerminalsAt(projectPath: string): string[] {
  return useTerminalStore(useShallow((s) => s.terminalsByProject[projectPath] ?? []));
}

interface GroupHeaderProps {
  groupKey: string;
  name: string;
  ptyIds: string[];
  icon?: ReactNode;
  selected?: boolean;
  actions?: ReactNode;
  rowProps?: Record<string, unknown>;
  onContextMenu?: (e: React.MouseEvent) => void;
  projectPath?: string;
  /** What clicking the name does. Without it the name folds the group too. */
  onOpen?: () => void;
  /** Stacks every terminal in the group, on ⌘-clicking the name. */
  onOpenAll?: () => void;
}

function GroupHeader({
  groupKey,
  name,
  ptyIds,
  icon,
  selected,
  actions,
  rowProps,
  onContextMenu,
  projectPath,
  onOpen,
  onOpenAll,
}: GroupHeaderProps) {
  const [collapsed, toggle] = useGroupCollapsed(groupKey);
  return (
    <div
      {...rowProps}
      className={`group/header h-7 flex items-center gap-0.5 px-1 rounded-[7px] ${selected ? ROW_SELECTED : ROW_IDLE}`}
      data-project-path={projectPath}
      data-group={groupKey}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        aria-label={collapsed ? `Show ${name}` : `Hide ${name}`}
        aria-expanded={!collapsed}
        className="w-5 h-5 flex items-center justify-center shrink-0 rounded-md text-text-secondary hover:text-text-primary hover:bg-ink/10"
        onClick={toggle}
      >
        <Icon
          name="caret-right"
          className="w-3 h-3 transition-transform duration-150 ease-out"
          style={{ transform: collapsed ? 'none' : 'rotate(90deg)' }}
        />
      </button>
      <button
        type="button"
        className="flex-1 min-w-0 h-7 flex items-center gap-2 pl-0.5 pr-1 text-left text-[13px] font-medium text-text-primary"
        onClick={(e) => {
          if (onOpenAll && isModKey(e)) onOpenAll();
          else (onOpen ?? toggle)();
        }}
      >
        {icon}
        <span className="truncate flex-1 min-w-0">{name}</span>
        {collapsed && <GroupDots ptyIds={ptyIds} />}
      </button>
      {actions}
    </div>
  );
}

const PAGE_ICONS: Record<ProjectPage, string> = {
  board: 'kanban',
  settings: 'gear',
  'pull-requests': 'git-pull-request',
  analysis: 'binoculars',
};

const ROW_BUTTON = 'w-6 h-6 flex items-center justify-center rounded-md transition-colors duration-100';
const rowButtonState = (active: boolean) =>
  active ? 'bg-ink/10 text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-ink/10';

function ProjectGroup({ project }: { project: Project }) {
  const ptyIds = useTerminalsAt(project.path);
  const [collapsed] = useGroupCollapsed(project.path);
  const openPage = useAppStore((s) =>
    s.selection.kind === 'page' && s.selection.projectPath === project.path ? s.selection.page : null,
  );
  const onScreen = useAppStore((s) => s.activeProjectPath === project.path);
  const wholeStack = stackFrom([projectUnit(project.path)]);
  const wholeShown = useStackShown(wholeStack);
  const flags = useProjectFlags(project.path);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.path });

  // Everything the row's own buttons do not: the other pages, a shell, and removal.
  const overflowPages: ProjectPage[] = [
    ...(flags.tracker ? (['pull-requests'] as const) : []),
    ...(flags.analysis ? (['analysis'] as const) : []),
    'settings',
  ];
  const overflow: ContextMenuEntry[] = [
    { label: 'New terminal', icon: 'terminal', onClick: () => void openShell(project.path) },
    ...(ptyIds.length > 0
      ? [{ label: 'All terminals', icon: 'cards-three', onClick: () => showProject(project.path, ptyIds) }]
      : []),
    { separator: true },
    ...overflowPages.map(
      (page): ContextMenuItem => ({
        label: PAGE_TITLES[page],
        icon: PAGE_ICONS[page],
        onClick: () => void openProjectPage(project.path, page),
      }),
    ),
  ];
  const openMenuAt = (x: number, y: number) => setMenu({ x, y });

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
    >
      <GroupHeader
        groupKey={project.path}
        name={project.name}
        ptyIds={ptyIds}
        projectPath={project.path}
        onOpen={() => void openProject(project.path)}
        onOpenAll={() => showProject(project.path, ptyIds)}
        icon={<ProjectTile project={project} />}
        selected={openPage !== null || wholeShown}
        rowProps={listeners}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuAt(e.clientX, e.clientY);
        }}
        actions={
          <div
            className={`flex gap-px shrink-0 transition-opacity duration-100 ${
              onScreen || menu ? 'opacity-100' : 'opacity-0 group-hover/header:opacity-100 focus-within:opacity-100'
            }`}
          >
            <Tooltip text={PAGE_TITLES.board} placement="bottom">
              <button
                type="button"
                aria-label={PAGE_TITLES.board}
                aria-current={openPage === 'board' ? 'page' : undefined}
                className={`${ROW_BUTTON} ${rowButtonState(openPage === 'board')}`}
                onClick={() => void openProjectPage(project.path, 'board')}
              >
                <Icon name={PAGE_ICONS.board} className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip text="New task" placement="bottom">
              <button
                type="button"
                aria-label={`New task in ${project.name}`}
                className={`${ROW_BUTTON} ${rowButtonState(false)}`}
                onClick={() => openTaskSheet(project.path)}
              >
                <Icon name="plus" className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip text="More" placement="bottom">
              <button
                type="button"
                aria-label={`More for ${project.name}`}
                aria-haspopup="menu"
                aria-expanded={menu !== null}
                className={`${ROW_BUTTON} ${rowButtonState(menu !== null || (openPage !== null && openPage !== 'board'))}`}
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  openMenuAt(box.left, box.bottom + 4);
                }}
              >
                <Icon name="dots-three" className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        }
      />
      {!collapsed && <GroupRows ptyIds={ptyIds} detail="diff" idleIn={project.path} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={overflow} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * Stacks everything in a project, resuming its in-progress and in-review tasks
 * that have nothing open, as picking them in the tree does. With nothing to
 * stack, its board.
 */
function showProject(projectPath: string, ptyIds: string[]): void {
  const stack = stackFrom([projectUnit(projectPath)]);
  const { displayStates } = useTerminalStore.getState();
  const { taskCacheByProject } = useAppStore.getState();
  const sleeping = groupByTask(ptyIds, displayStates, taskCacheByProject, [], projectPath).tasks.flatMap((group) =>
    group.ptyIds.length === 0 && group.task ? [group.task] : [],
  );
  if (ptyIds.length === 0 && sleeping.length === 0) return void openProjectPage(projectPath, 'board');
  void Promise.all(sleeping.map((task) => openTaskTerminal(projectPath, task, undefined, stack))).then(() =>
    showInListOrder(stack, [], projectPath),
  );
}

function useStackShown(stack: string | null): boolean {
  return useAppStore((s) => stack !== null && s.selection.kind === 'terminal' && s.selection.stack === stack);
}

function cloneSummary(job: CloneJob): string {
  if (job.status === 'failed') return 'Failed';
  return job.percent === null ? `${job.phase}…` : `${job.percent}%`;
}

/** A project that is still arriving: no drag, no context menu and nothing under it. */
function CloneRow({ projectPath, onSelect }: { projectPath: string; onSelect: () => void }) {
  const job = useAppStore(useMemo(() => selectCloneJob(projectPath), [projectPath]));
  const selected = useAppStore((s) => s.activeProjectPath === projectPath);
  if (!job) return null;
  return (
    <button
      type="button"
      className={`h-7 flex items-center gap-2 pl-[26px] pr-2.5 rounded-[7px] text-[13px] text-left ${selected ? ROW_SELECTED : ROW_IDLE}`}
      onClick={onSelect}
    >
      <span className="opacity-50">
        <ProjectTile project={{ name: job.name }} />
      </span>
      <span className="flex-1 min-w-0 truncate font-medium text-text-secondary">{job.name}</span>
      <span
        className={`shrink-0 font-mono text-[10.5px] ${job.status === 'failed' ? 'text-error' : 'text-text-tertiary'}`}
      >
        {cloneSummary(job)}
      </span>
    </button>
  );
}

/** Terminals opened somewhere no project is registered, such as a shell in the home directory. */
function PathGroup({ path }: { path: string }) {
  const ptyIds = useTerminalsAt(path);
  const [collapsed] = useGroupCollapsed(path);
  return (
    <div className="flex flex-col">
      <GroupHeader
        groupKey={path}
        name={homeRelative(path)}
        ptyIds={ptyIds}
        onOpenAll={() => showInListOrder(stackFrom([projectUnit(path)]))}
      />
      {!collapsed && <GroupRows ptyIds={ptyIds} detail="diff" />}
    </div>
  );
}

function TagsTree() {
  const opened = useTerminalStore(useShallow((s) => Object.values(s.terminalsByProject).flat()));
  const displays = useTerminalStore((s) => s.displayStates);
  const projectOrder = useAppStore(useShallow((s) => s.projects.map((p) => p.path)));
  const groups = useMemo(() => groupByTag(opened, displays), [opened, displays]);
  const tagged = groups.some((group) => group.tag !== null);
  return (
    <div className="flex flex-col gap-1.5">
      {!tagged && (
        <p className="px-2.5 py-1 text-[12.5px] leading-snug text-text-tertiary">
          No tags yet. Tag a terminal from its header to group it here.
        </p>
      )}
      {groups.map((group) => (
        <TagGroup
          key={group.key}
          groupKey={group.key}
          tag={group.tag}
          ptyIds={group.ptyIds}
          projectOrder={projectOrder}
        />
      ))}
    </div>
  );
}

function TagGroup({
  groupKey,
  tag,
  ptyIds,
  projectOrder,
}: {
  groupKey: string;
  tag: string | null;
  ptyIds: string[];
  projectOrder: string[];
}) {
  const [collapsed] = useGroupCollapsed(groupKey);
  const wholeStack = tag ? stackFrom([tagUnit(tag)]) : null;
  const wholeShown = useStackShown(wholeStack);
  return (
    <div className="flex flex-col">
      <GroupHeader
        groupKey={groupKey}
        name={tag ?? 'No tag'}
        ptyIds={ptyIds}
        icon={tag ? <Icon name="tag" className="w-3.5 h-3.5 text-text-secondary" /> : undefined}
        selected={wholeShown}
        onOpen={wholeStack ? () => showInListOrder(wholeStack, projectOrder) : undefined}
        onOpenAll={() => showInListOrder(wholeStack ?? stackFrom(ptyIds.map(terminalUnit)), projectOrder)}
      />
      {!collapsed && <GroupRows ptyIds={ptyIds} detail="project" projectOrder={projectOrder} />}
    </div>
  );
}
