import { create } from 'zustand';

export type HomeGroupMode = 'project' | 'tag';

interface UIStoreState {
  sidebarVisible: boolean;
  gitDropdownVisible: boolean;
  sandboxDropdownVisible: boolean;
  scriptDropdownVisible: boolean;
  /** ptyId of the terminal whose script dropdown is open */
  scriptDropdownPtyId: string | null;
  homeGroupMode: HomeGroupMode;
}

interface UIStoreActions {
  setSidebarVisible: (visible: boolean) => void;
  toggleSidebar: () => void;
  setGitDropdownVisible: (visible: boolean) => void;
  setSandboxDropdownVisible: (visible: boolean) => void;
  setScriptDropdownVisible: (visible: boolean, ptyId?: string | null) => void;
  closeAllDropdowns: () => void;
  setHomeGroupMode: (mode: HomeGroupMode) => void;
}

type UIStore = UIStoreState & UIStoreActions;

export const useUIStore = create<UIStore>()((set) => ({
  sidebarVisible: false,
  gitDropdownVisible: false,
  sandboxDropdownVisible: false,
  scriptDropdownVisible: false,
  scriptDropdownPtyId: null,
  homeGroupMode: 'project',

  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  setGitDropdownVisible: (visible) => set({ gitDropdownVisible: visible }),

  setSandboxDropdownVisible: (visible) => set({ sandboxDropdownVisible: visible }),

  setScriptDropdownVisible: (visible, ptyId) =>
    set({ scriptDropdownVisible: visible, scriptDropdownPtyId: visible ? (ptyId ?? null) : null }),

  closeAllDropdowns: () =>
    set({
      gitDropdownVisible: false,
      sandboxDropdownVisible: false,
      scriptDropdownVisible: false,
      scriptDropdownPtyId: null,
    }),

  setHomeGroupMode: (mode) => set({ homeGroupMode: mode }),
}));
