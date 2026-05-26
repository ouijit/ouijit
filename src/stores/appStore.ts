import { create } from 'zustand';
import type { Project, TaskWithWorkspace } from '../types';
import type { HealthStatus } from '../healthCheck';
import { withViewTransition, type ViewTransitionDirection } from '../utils/viewTransition';

export interface HomeRecentTask extends TaskWithWorkspace {
  project: Project;
}

const MAX_HOME_RECENTS = 8;

interface AppStoreState {
  activeView: 'home' | 'project';
  activeProjectPath: string | null;
  activeProjectData: Project | null;
  fullscreen: boolean;
  platform: 'darwin' | 'other';
  projects: Project[];
  sidebarSearch: string;
  sandboxAvailable: boolean;
  sandboxVmStatus: string;
  sandboxStarting: boolean;
  whatsNew: { version: string; notes: string } | null;
  helpDialogOpen: boolean;
  health: HealthStatus | null;
  homeActivePanel: 'home' | 'settings';
  homeRecents: HomeRecentTask[] | null;
  /** Per-project task cache. Source of truth for `homeRecents`; updated whenever
   *  any project's tasks are (re)loaded. Lets the home view paint instantly
   *  from cache while a background refresh reconciles. */
  taskCacheByProject: Record<string, TaskWithWorkspace[]>;
  _version: number;
}

interface AppStoreActions {
  setProjects: (projects: Project[]) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setSidebarSearch: (search: string) => void;
  setSandboxStatus: (available: boolean, vmStatus: string) => void;
  setSandboxStarting: (starting: boolean) => void;
  setWhatsNew: (info: { version: string; notes: string } | null) => void;
  setHelpDialogOpen: (open: boolean) => void;
  setHealth: (status: HealthStatus | null) => void;
  setHomeActivePanel: (panel: 'home' | 'settings') => void;
  navigateToProject: (path: string, project: Project, options?: { direction?: ViewTransitionDirection }) => void;
  navigateHome: (options?: { direction?: ViewTransitionDirection }) => void;
  loadHomeRecents: () => Promise<void>;
  /** Update one project's slice of the task cache; re-derives `homeRecents`. */
  updateProjectTaskCache: (projectPath: string, tasks: TaskWithWorkspace[]) => void;
  resetProjectState: () => void;
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

export const useAppStore = create<AppStore>()((set, get) => ({
  activeView: 'home',
  activeProjectPath: null,
  activeProjectData: null,
  fullscreen: false,
  platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'other',
  projects: [],
  sidebarSearch: '',
  sandboxAvailable: false,
  sandboxVmStatus: '',
  sandboxStarting: false,
  whatsNew: null,
  helpDialogOpen: false,
  health: null,
  homeActivePanel: 'home',
  homeRecents: null,
  taskCacheByProject: {},
  _version: 0,

  setProjects: (projects) => set({ projects }),

  setFullscreen: (fullscreen) => set({ fullscreen }),

  setSidebarSearch: (search) => set({ sidebarSearch: search }),

  setSandboxStatus: (available, vmStatus) => set({ sandboxAvailable: available, sandboxVmStatus: vmStatus }),

  setSandboxStarting: (starting) => set({ sandboxStarting: starting }),

  setWhatsNew: (info) => set({ whatsNew: info }),

  setHelpDialogOpen: (open) => set({ helpDialogOpen: open }),

  setHealth: (status) => set({ health: status }),

  setHomeActivePanel: (panel) =>
    withViewTransition(() => {
      set({ homeActivePanel: panel });
    }),

  navigateToProject: (path, project, options) =>
    withViewTransition(
      () => {
        const version = get()._version + 1;
        set({
          activeView: 'project',
          activeProjectPath: path,
          activeProjectData: project,
          _version: version,
        });
      },
      { direction: options?.direction },
    ),

  navigateHome: (options) =>
    withViewTransition(
      () => {
        const version = get()._version + 1;
        set({
          activeView: 'home',
          activeProjectPath: null,
          activeProjectData: null,
          homeActivePanel: 'home',
          _version: version,
        });
      },
      { direction: options?.direction },
    ),

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

  resetProjectState: () => {
    set({
      activeProjectPath: null,
      activeProjectData: null,
    });
  },
}));

/** Helper for checking staleness after async operations */
export function staleGuard(expectedVersion: number) {
  return () => useAppStore.getState()._version !== expectedVersion;
}
