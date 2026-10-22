import { create } from 'zustand';
import type { CloneJob, Project, TaskWithWorkspace } from '../types';
import type { HealthStatus } from '../healthCheck';
import { stackFrom, stackMembers, stackOf, unitsOf, useTerminalStore } from './terminalStore';

export interface HomeRecentTask extends TaskWithWorkspace {
  project: Project;
}

const MAX_HOME_RECENTS = 8;

export type ProjectPage = 'board' | 'settings' | 'pull-requests' | 'analysis';

/** What the main area shows. */
export type Selection =
  | { kind: 'terminal'; stack: string; projectPath: string }
  | { kind: 'page'; projectPath: string; page: ProjectPage }
  | { kind: 'app-settings' }
  | { kind: 'none' };

/** What a project goes back to when it is opened again. */
export type ProjectView =
  | Extract<Selection, { kind: 'terminal' }>
  | { kind: 'page'; projectPath: string; page: 'board' };

/**
 * `unit`'s stack joined to the one `selection` shows, when that is the same
 * project's: what you make there joins what you are looking at. Otherwise
 * `unit` alone, as a stack never spans two projects.
 */
export function joinStack(selection: Selection, projectPath: string, unit: string): string {
  if (selection.kind !== 'terminal' || selection.projectPath !== projectPath) return unit;
  return stackFrom([...unitsOf(selection.stack), unit]);
}

function isSettings(selection: Selection): boolean {
  return selection.kind === 'app-settings' || (selection.kind === 'page' && selection.page === 'settings');
}

function isProjectView(selection: Selection): selection is ProjectView {
  return selection.kind === 'terminal' || (selection.kind === 'page' && selection.page === 'board');
}

interface AppStoreState {
  selection: Selection;
  /** The registered project, or clone, whose terminal or page is on screen. */
  activeProjectPath: string | null;
  activeProjectData: Project | null;
  fullscreen: boolean;
  platform: 'darwin' | 'other';
  projects: Project[];
  /** Clones in flight, standing in for the projects they will become. */
  cloneJobs: CloneJob[];
  whatsNew: { version: string; notes: string } | null;
  /** Version shown by the About dialog; null while it is closed. */
  aboutVersion: string | null;
  helpDialogOpen: boolean;
  /**
   * How many composer sheets are open. The board reads this to leave Escape
   * alone while a sheet owns it, the same way it does for the hook and
   * worktree dialogs.
   *
   * A count, not a flag: the column composer, the standalone sheet and any
   * card can each open one and unmount independently, so a background
   * `loadTasks` remounting a card would clear a boolean under an open sheet.
   */
  composerSheetCount: number;
  /**
   * Session-only onboarding panel state, kept here rather than in
   * OnboardingPanel so "Hide for now" and the stuck state survive the kanban
   * being toggled off and back on.
   */
  onboardingSoftDismissed: boolean;
  onboardingStuckLatched: boolean;
  health: HealthStatus | null;
  homeRecents: HomeRecentTask[] | null;
  /** Every project's tasks, by path. Read through `projectDataStore`. */
  taskCacheByProject: Record<string, TaskWithWorkspace[]>;
  /** Each project's last board or terminal stack. */
  viewByProject: Record<string, ProjectView>;
  /** What was on screen when settings opened, for leaving them. */
  beforeSettings: Selection | null;
}

interface AppStoreActions {
  setProjects: (projects: Project[]) => void;
  setCloneJobs: (jobs: CloneJob[]) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setWhatsNew: (info: { version: string; notes: string } | null) => void;
  setAboutVersion: (version: string | null) => void;
  setHelpDialogOpen: (open: boolean) => void;
  /** Must be paired with `closeComposerSheet` when the sheet unmounts. */
  openComposerSheet: () => void;
  closeComposerSheet: () => void;
  setOnboardingSoftDismissed: (value: boolean) => void;
  setOnboardingStuckLatched: (value: boolean) => void;
  setHealth: (status: HealthStatus | null) => void;
  select: (selection: Selection) => void;
  /**
   * Brings a terminal to the front and shows `stack`, else the stack on screen
   * when the terminal is in it, else its own. False if it is not registered.
   */
  showTerminal: (ptyId: string, stack?: string) => boolean;
  /** Shows the project's most recently used terminal, or its board when it has none. */
  showProjectTerminals: (projectPath: string) => void;
  openPage: (projectPath: string, page: ProjectPage) => void;
  /** Back to what settings were opened over, while it still exists. */
  leaveSettings: () => void;
  /** The project's last board or terminal stack, while that stack still has terminals. */
  projectView: (projectPath: string) => ProjectView | null;
  rememberViews: (views: ProjectView[]) => void;
  loadHomeRecents: () => Promise<void>;
  /** Update one project's slice of the task cache; re-derives `homeRecents`. */
  updateProjectTaskCache: (projectPath: string, tasks: TaskWithWorkspace[]) => void;
}

function deriveHomeRecents(projects: Project[], cache: Record<string, TaskWithWorkspace[]>): HomeRecentTask[] {
  const projectByPath = new Map(projects.map((p) => [p.path, p]));
  const all: HomeRecentTask[] = [];
  for (const [path, tasks] of Object.entries(cache)) {
    const project = projectByPath.get(path);
    if (!project) continue;
    for (const t of tasks) all.push({ ...t, project });
  }
  return all
    .filter((t) => t.status !== 'done')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_HOME_RECENTS);
}

type AppStore = AppStoreState & AppStoreActions;

function selectionPath(selection: Selection): string | null {
  return selection.kind === 'terminal' || selection.kind === 'page' ? selection.projectPath : null;
}

/** A clone has no project row yet, so one is stood up from its job. */
function projectAt(state: Pick<AppStoreState, 'projects' | 'cloneJobs'>, path: string | null): Project | null {
  if (!path) return null;
  const project = state.projects.find((p) => p.path === path);
  if (project) return project;
  const job = state.cloneJobs.find((entry) => entry.projectPath === path);
  return job ? { name: job.name, path } : null;
}

function persistSelection(selection: Selection): void {
  const view =
    selection.kind === 'terminal'
      ? {
          type: 'terminal',
          ptyId: stackMembers(useTerminalStore.getState(), selection.stack)[0],
          stack: selection.stack,
        }
      : selection.kind === 'page'
        ? { type: 'page', path: selection.projectPath, page: selection.page }
        : { type: selection.kind };
  void window.api.globalSettings.set('lastActiveView', JSON.stringify(view));
}

/**
 * The clone standing in for the active project, when the project is not real
 * yet. The job object is replaced on every progress line, so anything that
 * only needs to know a clone is there should subscribe to `selectIsCloning`
 * instead of re-rendering with it.
 */
export function selectActiveClone(s: AppStoreState): CloneJob | undefined {
  return s.activeProjectPath ? s.cloneJobs.find((job) => job.projectPath === s.activeProjectPath) : undefined;
}

export function selectIsCloning(s: AppStoreState): boolean {
  return selectActiveClone(s) !== undefined;
}

/** The column composer only exists while the board is up. */
export function selectBoardOnScreen(s: AppStoreState): boolean {
  return s.selection.kind === 'page' && s.selection.page === 'board';
}

export function selectCloneJob(projectPath: string) {
  return (s: AppStoreState): CloneJob | undefined => s.cloneJobs.find((job) => job.projectPath === projectPath);
}

export const useAppStore = create<AppStore>()((set, get) => ({
  selection: { kind: 'none' },
  activeProjectPath: null,
  activeProjectData: null,
  fullscreen: false,
  platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'other',
  projects: [],
  cloneJobs: [],
  whatsNew: null,
  aboutVersion: null,
  helpDialogOpen: false,
  composerSheetCount: 0,
  onboardingSoftDismissed: false,
  onboardingStuckLatched: false,
  health: null,
  homeRecents: null,
  taskCacheByProject: {},
  viewByProject: {},
  beforeSettings: null,

  setProjects: (projects) => {
    const activeProjectData = projectAt({ projects, cloneJobs: get().cloneJobs }, get().activeProjectPath);
    set({ projects, activeProjectData, activeProjectPath: activeProjectData?.path ?? null });
  },
  setCloneJobs: (cloneJobs) => set({ cloneJobs }),

  setFullscreen: (fullscreen) => set({ fullscreen }),

  setWhatsNew: (info) => set({ whatsNew: info }),

  setAboutVersion: (version) => set({ aboutVersion: version }),

  setHelpDialogOpen: (open) => set({ helpDialogOpen: open }),

  openComposerSheet: () => set((s) => ({ composerSheetCount: s.composerSheetCount + 1 })),

  closeComposerSheet: () => set((s) => ({ composerSheetCount: Math.max(0, s.composerSheetCount - 1) })),

  setOnboardingSoftDismissed: (value) => set({ onboardingSoftDismissed: value }),

  setOnboardingStuckLatched: (value) => set({ onboardingStuckLatched: value }),

  setHealth: (status) => set({ health: status }),

  select: (selection) => {
    const activeProjectData = projectAt(get(), selectionPath(selection));
    const current = get().selection;
    set({
      selection,
      ...(isSettings(selection) && !isSettings(current) && { beforeSettings: current }),
      activeProjectData,
      activeProjectPath: activeProjectData?.path ?? null,
      ...(isProjectView(selection) && {
        viewByProject: { ...get().viewByProject, [selection.projectPath]: selection },
      }),
    });
    persistSelection(selection);
  },

  showTerminal: (ptyId, stack) => {
    const terminals = useTerminalStore.getState();
    const display = terminals.displayStates[ptyId];
    if (!display || !terminals.activate(ptyId)) return false;
    const current = get().selection;
    const keep = current.kind === 'terminal' && stackMembers(terminals, current.stack).includes(ptyId);
    const next = stack ?? (keep ? current.stack : stackOf(display));
    if (current.kind !== 'terminal' || current.stack !== next || current.projectPath !== display.projectPath) {
      get().select({ kind: 'terminal', stack: next, projectPath: display.projectPath });
    }
    return true;
  },

  showProjectTerminals: (projectPath) => {
    const { order, displayStates } = useTerminalStore.getState();
    const front = order.find((id) => displayStates[id]?.projectPath === projectPath);
    if (front) get().showTerminal(front);
    else get().openPage(projectPath, 'board');
  },

  openPage: (projectPath, page) => get().select({ kind: 'page', projectPath, page }),

  leaveSettings: () => {
    const { selection, beforeSettings } = get();
    const gone =
      !beforeSettings ||
      (beforeSettings.kind === 'terminal' &&
        stackMembers(useTerminalStore.getState(), beforeSettings.stack).length === 0);
    if (!gone) get().select(beforeSettings);
    else if (selection.kind === 'page') get().showProjectTerminals(selection.projectPath);
    else get().select({ kind: 'none' });
  },

  projectView: (projectPath) => {
    const view = get().viewByProject[projectPath];
    if (view?.kind === 'terminal' && stackMembers(useTerminalStore.getState(), view.stack).length === 0) return null;
    return view ?? null;
  },

  rememberViews: (views) =>
    set({ viewByProject: { ...get().viewByProject, ...Object.fromEntries(views.map((v) => [v.projectPath, v])) } }),

  loadHomeRecents: async () => {
    const projects = get().projects;
    const results = await Promise.all(
      projects.map((project) =>
        window.api.task
          .getAll(project.path)
          .then((tasks) => ({ path: project.path, tasks }))
          .catch(() => ({ path: project.path, tasks: [] as TaskWithWorkspace[] })),
      ),
    );
    const cache: Record<string, TaskWithWorkspace[]> = { ...get().taskCacheByProject };
    for (const { path, tasks } of results) cache[path] = tasks;
    set({ taskCacheByProject: cache, homeRecents: deriveHomeRecents(get().projects, cache) });
  },

  updateProjectTaskCache: (projectPath, tasks) => {
    const cache = { ...get().taskCacheByProject, [projectPath]: tasks };
    set({ taskCacheByProject: cache, homeRecents: deriveHomeRecents(get().projects, cache) });
  },
}));

// A stack empties when its last terminal closes. What takes its place is the
// project's next terminal, so closing a shell does not throw the user out of
// the project they were working in.
useTerminalStore.subscribe((terminals) => {
  const app = useAppStore.getState();
  const { selection } = app;
  if (selection.kind !== 'terminal' || stackMembers(terminals, selection.stack).length > 0) return;
  const next = terminals.order.find((id) => terminals.displayStates[id]?.projectPath === selection.projectPath);
  if (next) app.showTerminal(next);
  else if (app.activeProjectPath) app.openPage(app.activeProjectPath, 'board');
  else app.select({ kind: 'none' });
});
