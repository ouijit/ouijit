import { create } from 'zustand';

export type HomeGroupMode = 'project' | 'tag';

interface UIStoreState {
  sidebarVisible: boolean;
  /**
   * When true, sidebar stays open regardless of hover. Persisted in global
   * settings; defaults to pinned so the sidebar is discoverable on first launch.
   */
  sidebarPinned: boolean;
  gitDropdownVisible: boolean;
  homeGroupMode: HomeGroupMode;
  /** When set, the home terminal stack shows only sessions whose task has this tag (across all projects). */
  homeTagFilter: string | null;
}

interface UIStoreActions {
  setSidebarVisible: (visible: boolean) => void;
  toggleSidebar: () => void;
  setSidebarPinned: (pinned: boolean) => void;
  toggleSidebarPinned: () => void;
  setGitDropdownVisible: (visible: boolean) => void;
  closeAllDropdowns: () => void;
  setHomeGroupMode: (mode: HomeGroupMode) => void;
  setHomeTagFilter: (tag: string | null) => void;
}

type UIStore = UIStoreState & UIStoreActions;

export const useUIStore = create<UIStore>()((set, get) => ({
  sidebarVisible: false,
  sidebarPinned: true,
  gitDropdownVisible: false,
  homeGroupMode: 'project',
  homeTagFilter: null,

  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  setSidebarPinned: (pinned) => {
    set({ sidebarPinned: pinned });
    void window.api.globalSettings.set('ui:sidebar-pinned', pinned ? '1' : '0');
  },

  toggleSidebarPinned: () => {
    const next = !get().sidebarPinned;
    set({ sidebarPinned: next });
    void window.api.globalSettings.set('ui:sidebar-pinned', next ? '1' : '0');
  },

  setGitDropdownVisible: (visible) => set({ gitDropdownVisible: visible }),

  closeAllDropdowns: () => set({ gitDropdownVisible: false }),

  setHomeGroupMode: (mode) => set({ homeGroupMode: mode }),

  setHomeTagFilter: (tag) => set({ homeTagFilter: tag }),
}));
