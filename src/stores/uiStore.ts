import { create } from 'zustand';

export type HomeGroupMode = 'project' | 'tag';

/** How a project's terminals are arranged: a card stack, or a free canvas. */
export type TerminalLayout = 'stack' | 'canvas';

const SIDEBAR_PINNED_KEY = 'ui:sidebar-pinned';
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
  /**
   * The layout the user last asked for. Read it through `terminalLayout`, which
   * falls back to the stack while the canvas is switched off — so turning the
   * canvas off cannot strand the user on a view whose toggle has just gone.
   */
  preferredLayout: TerminalLayout;
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
  setPreferredLayout: (layout: TerminalLayout) => void;
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
  preferredLayout: 'stack',

  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  setSidebarPinned: (pinned) => {
    set({ sidebarPinned: pinned });
    void window.api.globalSettings.set(SIDEBAR_PINNED_KEY, pinned ? '1' : '0');
  },

  toggleSidebarPinned: () => get().setSidebarPinned(!get().sidebarPinned),

  setGitDropdownVisible: (visible) => set({ gitDropdownVisible: visible }),

  closeAllDropdowns: () => set({ gitDropdownVisible: false }),

  setHomeGroupMode: (mode) => set({ homeGroupMode: mode }),

  setHomeTagFilter: (tag) => set({ homeTagFilter: tag }),

  setHomeActivePtyId: (ptyId) => set({ homeActivePtyId: ptyId }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  setCanvasEnabled: (enabled) => {
    set({ canvasEnabled: enabled });
    void window.api.globalSettings.set(CANVAS_ENABLED_KEY, enabled ? '1' : '0');
  },

  setPreferredLayout: (layout) => {
    set({ preferredLayout: layout });
    void window.api.globalSettings.set(TERMINAL_LAYOUT_KEY, layout);
  },

  toggleTerminalLayout: () => get().setPreferredLayout(terminalLayout(get()) === 'stack' ? 'canvas' : 'stack'),
}));

/** The layout actually on screen. Doubles as a store selector and a plain getter. */
export function terminalLayout(state: UIStoreState = useUIStore.getState()): TerminalLayout {
  return state.canvasEnabled ? state.preferredLayout : 'stack';
}

/** Hydrate every persisted UI preference. Called once on launch. */
export async function hydrateUIPreferences(): Promise<void> {
  const [pinned, enabled, layout] = await Promise.all([
    window.api.globalSettings.get(SIDEBAR_PINNED_KEY),
    window.api.globalSettings.get(CANVAS_ENABLED_KEY),
    window.api.globalSettings.get(TERMINAL_LAYOUT_KEY),
  ]);
  useUIStore.setState({
    sidebarPinned: pinned !== '0',
    canvasEnabled: enabled === '1',
    preferredLayout: layout === 'canvas' ? 'canvas' : 'stack',
  });
}
