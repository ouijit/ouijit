import { create } from 'zustand';

export type HomeGroupMode = 'project' | 'tag';

interface UIStoreState {
  sidebarVisible: boolean;
  /** When true, sidebar stays open regardless of hover. Persisted in global settings. */
  sidebarPinned: boolean;
  gitDropdownVisible: boolean;
  scriptDropdownVisible: boolean;
  /** ptyId of the terminal whose script dropdown is open */
  scriptDropdownPtyId: string | null;
  homeGroupMode: HomeGroupMode;
}

interface UIStoreActions {
  setSidebarVisible: (visible: boolean) => void;
  toggleSidebar: () => void;
  setSidebarPinned: (pinned: boolean) => void;
  toggleSidebarPinned: () => void;
  setGitDropdownVisible: (visible: boolean) => void;
  setScriptDropdownVisible: (visible: boolean, ptyId?: string | null) => void;
  closeAllDropdowns: () => void;
  setHomeGroupMode: (mode: HomeGroupMode) => void;
}

type UIStore = UIStoreState & UIStoreActions;

export const useUIStore = create<UIStore>()((set, get) => ({
  sidebarVisible: false,
  sidebarPinned: false,
  gitDropdownVisible: false,
  scriptDropdownVisible: false,
  scriptDropdownPtyId: null,
  homeGroupMode: 'project',

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

  setScriptDropdownVisible: (visible, ptyId) =>
    set({ scriptDropdownVisible: visible, scriptDropdownPtyId: visible ? (ptyId ?? null) : null }),

  closeAllDropdowns: () =>
    set({
      gitDropdownVisible: false,
      scriptDropdownVisible: false,
      scriptDropdownPtyId: null,
    }),

  setHomeGroupMode: (mode) => set({ homeGroupMode: mode }),
}));
