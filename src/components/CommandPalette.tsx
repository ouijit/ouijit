/**
 * Mod+K switcher.
 *
 * Searches the three things you navigate between — live terminals, projects and
 * worktree-backed tasks — and jumps to one. Everything it can reach already
 * exists in a store or behind one IPC call, so opening it costs a
 * `getActiveSessions` round trip and a background task-cache refresh.
 *
 * It is a switcher, not a launcher: nothing here creates a worktree, changes a
 * task's status or runs a hook.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/appStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { fuzzyMatch, type MatchRange } from '../utils/fuzzyMatch';
import { projectIconColor, getInitials } from '../utils/projectIcon';
import { formatRelativeTime } from '../utils/formatDate';
import { Icon } from './terminal/Icon';
import { StatusDot } from './terminal/StatusDot';
import { selectProject, focusTerminal, openTaskWorktree } from './navigation';
import { useGithubStore } from '../stores/githubStore';
import { useExperimentalStore } from '../stores/experimentalStore';
import { openPullRequestInPanel } from '../services/githubTaskActions';
import type { ActiveSession, Project, SandboxProviderId, TaskWithWorkspace } from '../types';

/** A match on the primary text outranks the same match on supporting text. */
const PRIMARY_BONUS = 1;
/** Per-section cap, so one crowded section can't bury the others. */
const SECTION_LIMIT = 12;
/** Fade-out duration; matches the dialog transitions. */
const EXIT_MS = 200;

const STATUS_LABEL: Record<string, string> = {
  todo: 'to do',
  in_progress: 'in progress',
  in_review: 'to review',
  done: 'done',
};

type SectionKey = 'terminals' | 'projects' | 'tasks' | 'pulls';

const SECTION_ORDER: SectionKey[] = ['terminals', 'projects', 'tasks', 'pulls'];
const SECTION_TITLE: Record<SectionKey, string> = {
  terminals: 'Terminals',
  projects: 'Projects',
  tasks: 'Tasks',
  pulls: 'Pull requests',
};

interface PaletteItem {
  id: string;
  section: SectionKey;
  /** Matched and highlighted. */
  primary: string;
  /** Matched, shown dimmed, not highlighted. */
  secondary: string;
  /** Owning project, when there is one — drives the row thumbnail. */
  project?: Project;
  taskNumber?: number;
  tags?: string[];
  trailing?: string;
  dimmed?: boolean;
  /** Terminal rows carry the same status/sandbox dot their card header shows. */
  status?: { summaryType: string; sandboxProvider?: SandboxProviderId };
  run: () => void;
}

interface ScoredItem extends PaletteItem {
  score: number;
  ranges: MatchRange[];
}

function scoreItem(query: string, item: PaletteItem): ScoredItem | null {
  if (query.length === 0) return { ...item, score: 0, ranges: [] };
  const primary = fuzzyMatch(query, item.primary);
  const secondary = item.secondary ? fuzzyMatch(query, item.secondary) : null;
  if (!primary && !secondary) return null;
  const score = Math.max(primary ? primary.score + PRIMARY_BONUS : -Infinity, secondary ? secondary.score : -Infinity);
  return { ...item, score, ranges: primary?.ranges ?? [] };
}

/** Split text into matched / unmatched runs for highlighting. */
function highlight(text: string, ranges: MatchRange[]): React.ReactNode {
  if (ranges.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <span key={i} className="text-accent">
        {text.slice(start, end)}
      </span>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/**
 * Mount/unmount gate for the enter and exit transitions, mirroring how the
 * app's dialogs animate: paint once in the hidden state, flip visible on the
 * next frame, and hold the DOM for the length of the fade on the way out.
 * `openCount` keys the body so a reopen inside that window starts clean rather
 * than resurrecting the previous query.
 */
export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  // Bumped only on a closed→open transition, so the body remounts fresh on
  // reopen but never mid-session. Seeded from the initial `open` so the first
  // paint doesn't count as a transition — a bump there would remount the body
  // a frame after mount and wipe anything already typed.
  const [session, setSession] = useState(0);
  const wasOpen = useRef(open);

  useEffect(() => {
    const reopened = open && !wasOpen.current;
    wasOpen.current = open;
    if (open) {
      if (reopened) setSession((s) => s + 1);
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  return <PaletteBody key={session} visible={visible} />;
}

function PaletteBody({ visible }: { visible: boolean }) {
  const projects = useAppStore((s) => s.projects);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const taskCacheByProject = useAppStore((s) => s.taskCacheByProject);
  const terminalsByProject = useTerminalStore((s) => s.terminalsByProject);
  const displayStates = useTerminalStore((s) => s.displayStates);
  const githubEnabled = useExperimentalStore((s) =>
    activeProjectPath ? (s.flagsByProject[activeProjectPath]?.github ?? false) : false,
  );
  const inbox = useGithubStore((s) => s.inbox);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => useUIStore.getState().setPaletteOpen(false), []);

  // Live sessions are the authoritative terminal list — the store only holds
  // projects this renderer has hydrated. The task cache refresh reconciles in
  // the background; the palette paints from whatever is already cached.
  useEffect(() => {
    let cancelled = false;
    window.api.pty
      .getActiveSessions()
      .then((live) => {
        if (!cancelled) setSessions(live);
      })
      .catch(() => {
        /* store-backed terminals still list */
      });
    void useAppStore.getState().loadHomeRecents();
    // Same background-refresh idea as the task cache: paint from whatever is
    // already loaded, and reconcile behind the user. Only when the flag is on,
    // so a project without GitHub never pays for a `gh` fork here.
    if (githubEnabled && activeProjectPath) {
      const store = useGithubStore.getState();
      store.setProject(activeProjectPath);
      void store.loadInbox(activeProjectPath);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-once effect; the palette remounts per session
  }, []);

  // Focus before paint, not on the next frame. A deferred focus leaves a window
  // where the palette is on screen but the keystrokes still belong to whatever
  // had focus before — typically an xterm, which would eat the first characters
  // typed and the Escape that was meant to dismiss this.
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape at the document level, in capture, the way the dialogs handle it —
  // dismissal must not depend on focus being somewhere in particular.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [close]);

  const projectByPath = useMemo(() => new Map(projects.map((p) => [p.path, p])), [projects]);

  const items = useMemo<PaletteItem[]>(() => {
    const result: PaletteItem[] = [];

    // ── Terminals ──
    // Store first (rich display state), then any live session this renderer
    // hasn't hydrated. Runners are panels on a parent card, not switchable
    // terminals; loading slots have no session behind them yet.
    const seenPtyIds = new Set<string>();
    const terminalItems: { item: PaletteItem; rank: number }[] = [];

    for (const [projectPath, ptyIds] of Object.entries(terminalsByProject)) {
      for (const ptyId of ptyIds) {
        const display = displayStates[ptyId];
        if (!display || display.isLoading) continue;
        seenPtyIds.add(ptyId);
        const project = projectByPath.get(projectPath);
        terminalItems.push({
          rank: projectPath === activeProjectPath ? 0 : 1,
          item: {
            id: `terminal:${ptyId}`,
            section: 'terminals',
            primary: display.label || 'Terminal',
            secondary: project?.name ?? projectPath,
            project,
            taskNumber: display.taskId ?? undefined,
            tags: display.tags,
            trailing: display.exited ? 'exited' : undefined,
            dimmed: display.exited,
            status: { summaryType: display.summaryType, sandboxProvider: display.sandboxProvider },
            run: () => void focusTerminal(ptyId, projectPath),
          },
        });
      }
    }

    for (const session of sessions) {
      if (session.isRunner || seenPtyIds.has(session.ptyId)) continue;
      seenPtyIds.add(session.ptyId);
      const project = projectByPath.get(session.projectPath);
      terminalItems.push({
        rank: session.projectPath === activeProjectPath ? 0 : 2,
        item: {
          id: `terminal:${session.ptyId}`,
          section: 'terminals',
          primary: session.label || 'Terminal',
          secondary: project?.name ?? session.projectPath,
          project,
          taskNumber: session.taskId ?? undefined,
          // Not hydrated yet, so there's no live summary — the card will show
          // the real one once it reconnects.
          status: { summaryType: 'ready', sandboxProvider: session.sandboxProvider },
          run: () => void focusTerminal(session.ptyId, session.projectPath),
        },
      });
    }

    terminalItems.sort((a, b) => a.rank - b.rank);
    result.push(...terminalItems.map((t) => t.item));

    // ── Projects ──
    for (const project of projects) {
      result.push({
        id: `project:${project.path}`,
        section: 'projects',
        primary: project.name,
        secondary: project.path,
        project,
        run: () => void selectProject(project.path, project),
      });
    }

    // ── Tasks ──
    // Only tasks with a worktree already on disk: opening one is then a plain
    // shell in an existing directory, never a task start. A task whose terminal
    // is already live is reachable from the Terminals section instead.
    const liveTaskKeys = new Set<string>();
    for (const display of Object.values(displayStates)) {
      if (display.taskId != null) liveTaskKeys.add(`${display.projectPath}#${display.taskId}`);
    }
    for (const session of sessions) {
      if (session.taskId != null) liveTaskKeys.add(`${session.projectPath}#${session.taskId}`);
    }

    const taskItems: { item: PaletteItem; createdAt: string }[] = [];
    for (const [projectPath, tasks] of Object.entries(taskCacheByProject)) {
      const project = projectByPath.get(projectPath);
      if (!project) continue;
      for (const task of tasks) {
        if (!task.worktreePath || !task.branch) continue;
        if (liveTaskKeys.has(`${projectPath}#${task.taskNumber}`)) continue;
        taskItems.push({ createdAt: task.createdAt, item: taskItem(project, task) });
      }
    }
    taskItems.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    result.push(...taskItems.map((t) => t.item));

    // ── Pull requests ──
    // Navigation only: opening one shows it in the project panel. Nothing here
    // creates a worktree or writes to GitHub, matching the rest of the palette.
    if (githubEnabled && activeProjectPath && inbox) {
      const project = projectByPath.get(activeProjectPath);
      const seen = new Set<number>();
      for (const pr of [...inbox.needsReview, ...inbox.mine, ...inbox.others]) {
        if (seen.has(pr.number)) continue;
        seen.add(pr.number);
        result.push({
          id: `pull:${pr.number}`,
          section: 'pulls',
          primary: pr.title,
          secondary: `#${pr.number} ${pr.author}`,
          project,
          taskNumber: inbox.linkedTasks[pr.number],
          trailing: pr.reviewRequested && !pr.isMine ? 'needs review' : undefined,
          run: () => openPullRequestInPanel(activeProjectPath, pr.number),
        });
      }
    }

    return result;
  }, [
    projects,
    projectByPath,
    activeProjectPath,
    terminalsByProject,
    displayStates,
    sessions,
    taskCacheByProject,
    githubEnabled,
    inbox,
  ]);

  const sections = useMemo(() => {
    const scored = items.map((item) => scoreItem(query, item)).filter((i): i is ScoredItem => i !== null);
    return SECTION_ORDER.map((key) => {
      const rows = scored.filter((i) => i.section === key);
      // With no query the arrays are already in their default order; a query
      // re-ranks within each section but never reorders the sections.
      if (query.length > 0) rows.sort((a, b) => b.score - a.score);
      return { key, rows: rows.slice(0, SECTION_LIMIT) };
    }).filter((s) => s.rows.length > 0);
  }, [items, query]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  // Keep the cursor in range as results change under it.
  useEffect(() => {
    setSelected((current) => (current >= flat.length ? 0 : current));
  }, [flat.length]);

  useEffect(() => {
    // Optional call: jsdom doesn't implement scrollIntoView.
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  // Close before running: `navigateToProject` wraps `startViewTransition`,
  // which snapshots the whole document — an overlay still mounted would be
  // captured in the outgoing frame and crossfade away.
  const activate = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      close();
      requestAnimationFrame(() => item.run());
    },
    [close],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((current) => (flat.length === 0 ? 0 : (current + 1) % flat.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((current) => (flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        activate(flat[selected]);
      }
    },
    [flat, selected, activate],
  );

  let rowIndex = -1;

  return createPortal(
    <div
      data-testid="command-palette"
      data-visible={visible}
      className={`fixed inset-0 z-[10003] flex justify-center px-6 pt-[14vh] pb-10 transition-opacity duration-200 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`glass-bevel w-full max-w-[40rem] max-h-full flex flex-col rounded-[14px] border border-bezel-panel overflow-hidden ${
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2'
        }`}
        style={{
          background: 'var(--color-terminal-bg)',
          boxShadow: 'var(--shadow-panel)',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
        }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/[0.06] shrink-0">
          <span className="shrink-0 text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
            <Icon name="magnifying-glass" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Jump to a terminal, project or task"
            spellCheck={false}
            aria-label="Search terminals, projects and tasks"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary [-webkit-app-region:no-drag]"
          />
        </div>

        {flat.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-text-tertiary">No matches</div>
        ) : (
          <div role="listbox" aria-label="Results" className="flex-1 min-h-0 overflow-y-auto settings-scrollable py-1">
            {sections.map((section) => (
              <div key={section.key} role="group" aria-label={SECTION_TITLE[section.key]}>
                <div
                  className="sticky top-0 z-10 px-4 py-1.5 text-[11px] text-text-tertiary"
                  style={{ background: 'var(--color-terminal-bg)' }}
                >
                  {SECTION_TITLE[section.key]}
                </div>
                {section.rows.map((row) => {
                  rowIndex++;
                  const isSelected = rowIndex === selected;
                  const index = rowIndex;
                  return (
                    <PaletteRow
                      key={row.id}
                      row={row}
                      selected={isSelected}
                      rowRef={isSelected ? selectedRef : undefined}
                      onHover={() => setSelected(index)}
                      onClick={() => activate(row)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function taskItem(project: Project, task: TaskWithWorkspace): PaletteItem {
  return {
    id: `task:${project.path}#${task.taskNumber}`,
    section: 'tasks',
    primary: task.name || 'Untitled',
    secondary: project.name,
    project,
    taskNumber: task.taskNumber,
    trailing: `${STATUS_LABEL[task.status] ?? task.status} · ${formatRelativeTime(new Date(task.createdAt))}`,
    run: () =>
      void openTaskWorktree({
        project,
        taskNumber: task.taskNumber,
        worktreePath: task.worktreePath as string,
        branch: task.branch as string,
        createdAt: task.createdAt,
      }),
  };
}

interface PaletteRowProps {
  row: ScoredItem;
  selected: boolean;
  rowRef?: React.RefObject<HTMLDivElement | null>;
  onHover: () => void;
  onClick: () => void;
}

function PaletteRow({ row, selected, rowRef, onHover, onClick }: PaletteRowProps) {
  return (
    <div
      ref={rowRef}
      role="option"
      aria-selected={selected}
      data-testid="palette-row"
      onMouseMove={onHover}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2 cursor-default transition-colors duration-100 ease-out [-webkit-app-region:no-drag] ${
        selected ? 'bg-accent/15' : ''
      }`}
    >
      {row.project ? (
        <div className="project-tile w-7 h-7 shrink-0 overflow-hidden">
          <div
            className="w-full h-full flex items-center justify-center text-xs font-bold text-white"
            style={{ backgroundColor: projectIconColor(row.project), textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
          >
            {getInitials(row.project.name)}
          </div>
        </div>
      ) : (
        <span className="w-7 h-7 shrink-0 flex items-center justify-center text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
          <Icon name="terminal" />
        </span>
      )}

      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-2 min-w-0">
          {row.status && (
            <StatusDot summaryType={row.status.summaryType} sandboxProvider={row.status.sandboxProvider} />
          )}
          {row.taskNumber != null && (
            <span className="font-mono text-[11px] text-text-tertiary tabular-nums shrink-0">T-{row.taskNumber}</span>
          )}
          <span className={`text-sm truncate ${row.dimmed ? 'text-text-tertiary' : 'text-text-primary'}`}>
            {highlight(row.primary, row.ranges)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary min-w-0">
          <span className="truncate">{row.secondary}</span>
          {row.tags && row.tags.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{row.tags.join(', ')}</span>
            </>
          )}
        </div>
      </div>

      {row.trailing && <span className="shrink-0 text-[11px] text-text-tertiary">{row.trailing}</span>}
    </div>
  );
}
