import { create } from 'zustand';
import type { TaskWithWorkspace } from '../types';
import { queuePrompt, settlePrompt, type Pending } from './promptQueue';

export type HomeGroupMode = 'project' | 'tag';

export type MissingWorktreeAction = 'recover' | null;

export interface MissingWorktreeInput {
  task: TaskWithWorkspace;
  branchExists: boolean;
}

export type MissingWorktreeRequest = MissingWorktreeInput & Pending<MissingWorktreeAction>;

interface UIStoreState {
  sidebarVisible: boolean;
  /** When true, sidebar stays open regardless of hover. Persisted in global settings. */
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
  /** Opening several tasks at once can find more than one worktree missing. */
  missingWorktreeQueue: MissingWorktreeRequest[];
  diffFileListCollapsed: boolean;
  diffFileListWidth: number;
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
  requestMissingWorktree: (req: MissingWorktreeInput) => Promise<MissingWorktreeAction>;
  resolveMissingWorktree: (id: number, action: MissingWorktreeAction) => void;
  setDiffFileListCollapsed: (collapsed: boolean) => void;
  setDiffFileListWidth: (width: number) => void;
}

type UIStore = UIStoreState & UIStoreActions;

export const DIFF_FILE_LIST_DEFAULT_WIDTH = 220;
export const DIFF_FILE_LIST_MIN_WIDTH = 120;
export const DIFF_FILE_LIST_MAX_WIDTH = 500;

function clampFileListWidth(width: number): number {
  return Math.max(DIFF_FILE_LIST_MIN_WIDTH, Math.min(DIFF_FILE_LIST_MAX_WIDTH, Math.round(width)));
}

export const useUIStore = create<UIStore>()((set, get) => ({
  sidebarVisible: false,
  sidebarPinned: false,
  gitDropdownVisible: false,
  homeGroupMode: 'project',
  homeTagFilter: null,
  homeActivePtyId: null,
  paletteOpen: false,
  missingWorktreeQueue: [],
  diffFileListCollapsed: false,
  diffFileListWidth: DIFF_FILE_LIST_DEFAULT_WIDTH,

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
    queuePrompt<MissingWorktreeInput, MissingWorktreeAction>(req, (entry) =>
      set((s) => ({ missingWorktreeQueue: [...s.missingWorktreeQueue, entry] })),
    ),

  resolveMissingWorktree: (id, action) => {
    const next = settlePrompt(get().missingWorktreeQueue, id, action);
    if (next) set({ missingWorktreeQueue: next });
  },

  setDiffFileListCollapsed: (collapsed) => {
    set({ diffFileListCollapsed: collapsed });
    void window.api.globalSettings.set('ui:diff-file-list-collapsed', collapsed ? '1' : '0');
  },

  setDiffFileListWidth: (width) => {
    const clamped = clampFileListWidth(width);
    set({ diffFileListWidth: clamped });
    void window.api.globalSettings.set('ui:diff-file-list-width', String(clamped));
  },
}));

export async function hydrateUIPreferences(): Promise<void> {
  const [pinned, collapsed, width] = await Promise.all([
    window.api.globalSettings.get('ui:sidebar-pinned'),
    window.api.globalSettings.get('ui:diff-file-list-collapsed'),
    window.api.globalSettings.get('ui:diff-file-list-width'),
  ]);

  const next: Partial<UIStoreState> = {};
  if (pinned === '0' || pinned === '1') next.sidebarPinned = pinned === '1';
  if (collapsed === '0' || collapsed === '1') next.diffFileListCollapsed = collapsed === '1';
  const parsedWidth = Number(width);
  if (width && Number.isFinite(parsedWidth)) next.diffFileListWidth = clampFileListWidth(parsedWidth);

  useUIStore.setState(next);
}
