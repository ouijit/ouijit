import { create } from 'zustand';

export type HomeGroupMode = 'project' | 'tag';

/** How a project's terminals are arranged: a card stack, or a free canvas. */
export type TerminalLayout = 'stack' | 'canvas';

const CANVAS_ENABLED_KEY = 'ui:canvas-enabled';
const TERMINAL_LAYOUT_KEY = 'ui:terminal-layout';

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
   * Canvas layout, still behind an experimental toggle. Global rather than
   * per-project: it is a way of looking at terminals, not a property of a repo.
   */
  canvasEnabled: boolean;
  /** Which arrangement the terminals view shows. Persisted with canvasEnabled. */
  terminalLayout: TerminalLayout;
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
  setCanvasEnabled: (enabled: boolean) => void;
  setTerminalLayout: (layout: TerminalLayout) => void;
  toggleTerminalLayout: () => void;
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
  canvasEnabled: false,
  terminalLayout: 'stack',

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

  setCanvasEnabled: (enabled) => {
    // Turning the canvas off while it is showing would strand the user on a
    // view whose toggle has just disappeared.
    set(enabled ? { canvasEnabled: true } : { canvasEnabled: false, terminalLayout: 'stack' });
    void window.api.globalSettings.set(CANVAS_ENABLED_KEY, enabled ? '1' : '0');
    if (!enabled) void window.api.globalSettings.set(TERMINAL_LAYOUT_KEY, 'stack');
  },

  setTerminalLayout: (layout) => {
    set({ terminalLayout: layout });
    void window.api.globalSettings.set(TERMINAL_LAYOUT_KEY, layout);
  },

  toggleTerminalLayout: () => get().setTerminalLayout(get().terminalLayout === 'stack' ? 'canvas' : 'stack'),
}));

/** Hydrate the persisted layout preferences. Called once on launch. */
export async function loadLayoutPreferences(): Promise<void> {
  const [enabled, layout] = await Promise.all([
    window.api.globalSettings.get(CANVAS_ENABLED_KEY),
    window.api.globalSettings.get(TERMINAL_LAYOUT_KEY),
  ]);
  const canvasEnabled = enabled === '1';
  useUIStore.setState({
    canvasEnabled,
    terminalLayout: canvasEnabled && layout === 'canvas' ? 'canvas' : 'stack',
  });
}
