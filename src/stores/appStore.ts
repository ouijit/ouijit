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
  health: HealthStatus | null;
  homeActivePanel: 'home' | 'settings';
  homeRecents: HomeRecentTask[] | null;
  _version: number;
}

interface AppStoreActions {
  setProjects: (projects: Project[]) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setSidebarSearch: (search: string) => void;
  setSandboxStatus: (available: boolean, vmStatus: string) => void;
  setSandboxStarting: (starting: boolean) => void;
  setWhatsNew: (info: { version: string; notes: string } | null) => void;
  setHealth: (status: HealthStatus | null) => void;
  setHomeActivePanel: (panel: 'home' | 'settings') => void;
  navigateToProject: (path: string, project: Project, options?: { direction?: ViewTransitionDirection }) => void;
  navigateHome: (options?: { direction?: ViewTransitionDirection }) => void;
  loadHomeRecents: () => Promise<void>;
  resetProjectState: () => void;
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
  health: null,
  homeActivePanel: 'home',
  homeRecents: null,
  _version: 0,

  setProjects: (projects) => set({ projects }),

  setFullscreen: (fullscreen) => set({ fullscreen }),

  setSidebarSearch: (search) => set({ sidebarSearch: search }),

  setSandboxStatus: (available, vmStatus) => set({ sandboxAvailable: available, sandboxVmStatus: vmStatus }),

  setSandboxStarting: (starting) => set({ sandboxStarting: starting }),

  setWhatsNew: (info) => set({ whatsNew: info }),

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
    const arrays = await Promise.all(
      projects.map((project) =>
        window.api.task
          .getAll(project.path)
          .then((tasks) => tasks.map((t) => ({ ...t, project })))
          .catch(() => [] as HomeRecentTask[]),
      ),
    );
    const recents = arrays
      .flat()
      .filter((t) => t.status !== 'done')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_HOME_RECENTS);
    set({ homeRecents: recents });
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
