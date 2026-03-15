import { create } from 'zustand';

export type HomeGroupMode = 'project' | 'tag';

interface UIStoreState {
  sidebarVisible: boolean;
  gitDropdownVisible: boolean;
  launchDropdownVisible: boolean;
  sandboxDropdownVisible: boolean;
  homeGroupMode: HomeGroupMode;
}

interface UIStoreActions {
  setSidebarVisible: (visible: boolean) => void;
  toggleSidebar: () => void;
  setGitDropdownVisible: (visible: boolean) => void;
  setLaunchDropdownVisible: (visible: boolean) => void;
  setSandboxDropdownVisible: (visible: boolean) => void;
  closeAllDropdowns: () => void;
  setHomeGroupMode: (mode: HomeGroupMode) => void;
}

type UIStore = UIStoreState & UIStoreActions;

export const useUIStore = create<UIStore>()((set) => ({
  sidebarVisible: false,
  gitDropdownVisible: false,
  launchDropdownVisible: false,
  sandboxDropdownVisible: false,
  homeGroupMode: 'project',

  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  setGitDropdownVisible: (visible) => set({ gitDropdownVisible: visible }),

  setLaunchDropdownVisible: (visible) => set({ launchDropdownVisible: visible }),

  setSandboxDropdownVisible: (visible) => set({ sandboxDropdownVisible: visible }),

  closeAllDropdowns: () =>
    set({
      gitDropdownVisible: false,
      launchDropdownVisible: false,
      sandboxDropdownVisible: false,
    }),

  setHomeGroupMode: (mode) => set({ homeGroupMode: mode }),
}));
