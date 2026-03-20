import { create } from 'zustand';
import type { Project } from '../types';

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
  _version: number;
}

interface AppStoreActions {
  setProjects: (projects: Project[]) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setSidebarSearch: (search: string) => void;
  setSandboxStatus: (available: boolean, vmStatus: string) => void;
  navigateToProject: (path: string, project: Project) => void;
  navigateHome: () => void;
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
  _version: 0,

  setProjects: (projects) => set({ projects }),

  setFullscreen: (fullscreen) => set({ fullscreen }),

  setSidebarSearch: (search) => set({ sidebarSearch: search }),

  setSandboxStatus: (available, vmStatus) => set({ sandboxAvailable: available, sandboxVmStatus: vmStatus }),

  navigateToProject: (path, project) => {
    const version = get()._version + 1;
    set({
      activeView: 'project',
      activeProjectPath: path,
      activeProjectData: project,
      _version: version,
    });
  },

  navigateHome: () => {
    const version = get()._version + 1;
    set({
      activeView: 'home',
      activeProjectPath: null,
      activeProjectData: null,
      _version: version,
    });
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
