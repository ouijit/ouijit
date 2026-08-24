import { create } from 'zustand';
import type { TaskWithWorkspace } from '../types';

export type HomeGroupMode = 'project' | 'tag';

export type MissingWorktreeAction = 'recover' | null;

/** A pending "this worktree is gone" prompt. `resolve` settles the waiting `ensureWorktree`. */
export interface MissingWorktreeRequest {
  id: number;
  task: TaskWithWorkspace;
  branchExists: boolean;
  resolve: (action: MissingWorktreeAction) => void;
}

let missingWorktreeCounter = 0;

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
  /**
   * Front card of the home terminal stack. Lives here rather than in HomeView
   * so the command palette can bring a home-owned session to the front from
   * anywhere; HomeView still owns the stack's depth/recency ordering.
   */
  homeActivePtyId: string | null;
  /** Command palette (mod+K) visibility. Session-only. */
  paletteOpen: boolean;
  /**
   * Opening several tasks at once can find more than one worktree missing, so
   * these queue and are answered one at a time rather than the newest evicting
   * the prior one — whose awaiting `ensureWorktree` would never settle.
   */
  missingWorktreeQueue: MissingWorktreeRequest[];
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
  setHomeActivePtyId: (ptyId: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  requestMissingWorktree: (req: Omit<MissingWorktreeRequest, 'id' | 'resolve'>) => Promise<MissingWorktreeAction>;
  resolveMissingWorktree: (id: number, action: MissingWorktreeAction) => void;
}

type UIStore = UIStoreState & UIStoreActions;

export const useUIStore = create<UIStore>()((set, get) => ({
  sidebarVisible: false,
  sidebarPinned: true,
  gitDropdownVisible: false,
  homeGroupMode: 'project',
  homeTagFilter: null,
  homeActivePtyId: null,
  paletteOpen: false,
  missingWorktreeQueue: [],

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

  setHomeActivePtyId: (ptyId) => set({ homeActivePtyId: ptyId }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  requestMissingWorktree: (req) =>
    new Promise<MissingWorktreeAction>((resolve) => {
      const id = ++missingWorktreeCounter;
      set((s) => ({ missingWorktreeQueue: [...s.missingWorktreeQueue, { ...req, id, resolve }] }));
    }),

  resolveMissingWorktree: (id, action) => {
    const target = get().missingWorktreeQueue.find((r) => r.id === id);
    if (!target) return;
    set((s) => ({ missingWorktreeQueue: s.missingWorktreeQueue.filter((r) => r.id !== id) }));
    target.resolve(action);
  },
}));
