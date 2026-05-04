import { create } from 'zustand';
import type { GitFileStatus } from '../types';

/** Renderable state pushed from OuijitTerminal class to React */
export interface TerminalDisplayState {
  ptyId: string;
  label: string;
  summary: string;
  summaryType: 'thinking' | 'ready';
  gitFileStatus: GitFileStatus | null;
  lastOscTitle: string;
  tags: string[];
  hookStatus: 'thinking' | 'ready' | null;
  runnerStatus: 'running' | 'success' | 'error' | 'idle';
  runnerScriptName: string | null;
  runnerPanelOpen: boolean;
  runnerFullWidth: boolean;
  diffPanelOpen: boolean;
  diffPanelSelectedFile: string | null;
  diffPanelMode: 'uncommitted' | 'worktree';
  planPath: string | null;
  planPanelOpen: boolean;
  planFullWidth: boolean;
  webPreviewUrl: string | null;
  webPreviewPanelOpen: boolean;
  webPreviewFullWidth: boolean;
  sandboxed: boolean;
  taskId: number | null;
  worktreeBranch: string | null;
  projectPath: string;
  exited: boolean;
  /** Placeholder slot for an in-flight task start. Card renders the loading
   *  body; the slot will be rekey'd + flag cleared when the real PTY spawns. */
  isLoading: boolean;
}

export const DEFAULT_DISPLAY_STATE: Omit<TerminalDisplayState, 'ptyId' | 'projectPath'> = {
  label: '',
  summary: '',
  summaryType: 'ready',
  gitFileStatus: null,
  lastOscTitle: '',
  tags: [],
  hookStatus: null,
  runnerStatus: 'idle',
  runnerScriptName: null,
  runnerPanelOpen: false,
  runnerFullWidth: true,
  diffPanelOpen: false,
  diffPanelSelectedFile: null,
  diffPanelMode: 'uncommitted',
  planPath: null,
  planPanelOpen: false,
  planFullWidth: true,
  webPreviewUrl: null,
  webPreviewPanelOpen: false,
  webPreviewFullWidth: true,
  sandboxed: false,
  taskId: null,
  worktreeBranch: null,
  exited: false,
  isLoading: false,
};

export const STACK_PAGE_SIZE = 5;

interface TerminalStoreState {
  /** Per-terminal renderable state keyed by ptyId */
  displayStates: Record<string, TerminalDisplayState>;
  /** Ordered list of terminal ptyIds per project path */
  terminalsByProject: Record<string, string[]>;
  /** Active terminal index per project path */
  activeIndices: Record<string, number>;
  /** Loading card label (shown during worktree creation) */
  loadingLabel: string | null;
}

interface TerminalStoreActions {
  addTerminal: (projectPath: string, ptyId: string, initial: Partial<TerminalDisplayState>) => void;
  removeTerminal: (ptyId: string) => void;
  updateDisplay: (ptyId: string, patch: Partial<TerminalDisplayState>) => void;
  /**
   * Swap a terminal's key from a placeholder id to the real PTY id. Sandbox
   * terminals register under a per-instance placeholder id before the VM
   * finishes spawning so the loading card can render; once the PTY exists
   * we re-key all per-pty state to the real id.
   */
  rekeyTerminal: (oldPtyId: string, newPtyId: string) => void;
  setActiveIndex: (projectPath: string, index: number) => void;
  activateLast: (projectPath: string) => void;
  clearProject: (projectPath: string) => void;
  setLoadingLabel: (label: string | null) => void;
}

type TerminalStore = TerminalStoreState & TerminalStoreActions;

export const useTerminalStore = create<TerminalStore>()((set, get) => ({
  displayStates: {},
  terminalsByProject: {},
  activeIndices: {},
  loadingLabel: null,

  addTerminal: (projectPath, ptyId, initial) => {
    const state = get();
    const projectTerminals = state.terminalsByProject[projectPath] ?? [];
    set({
      displayStates: {
        ...state.displayStates,
        [ptyId]: {
          ...DEFAULT_DISPLAY_STATE,
          ptyId,
          projectPath,
          ...initial,
        } as TerminalDisplayState,
      },
      terminalsByProject: {
        ...state.terminalsByProject,
        [projectPath]: [...projectTerminals, ptyId],
      },
    });
  },

  removeTerminal: (ptyId) => {
    const state = get();
    const display = state.displayStates[ptyId];
    if (!display) return;

    const { [ptyId]: _, ...remainingDisplays } = state.displayStates;
    const projectPath = display.projectPath;
    const projectTerminals = (state.terminalsByProject[projectPath] ?? []).filter((id) => id !== ptyId);
    const removedIndex = (state.terminalsByProject[projectPath] ?? []).indexOf(ptyId);

    // Adjust active index for this project
    const currentActive = state.activeIndices[projectPath] ?? 0;
    let newActive = currentActive;
    if (projectTerminals.length === 0) {
      newActive = 0;
    } else if (currentActive >= projectTerminals.length) {
      newActive = projectTerminals.length - 1;
    } else if (removedIndex < currentActive) {
      newActive = currentActive - 1;
    }

    set({
      displayStates: remainingDisplays,
      terminalsByProject: {
        ...state.terminalsByProject,
        [projectPath]: projectTerminals,
      },
      activeIndices: {
        ...state.activeIndices,
        [projectPath]: newActive,
      },
    });
  },

  updateDisplay: (ptyId, patch) => {
    const state = get();
    const existing = state.displayStates[ptyId];
    if (!existing) return;

    set({
      displayStates: {
        ...state.displayStates,
        [ptyId]: { ...existing, ...patch },
      },
    });
  },

  rekeyTerminal: (oldPtyId, newPtyId) => {
    if (oldPtyId === newPtyId) return;
    const state = get();
    const existing = state.displayStates[oldPtyId];
    if (!existing) return;

    const nextDisplayStates = { ...state.displayStates };
    delete nextDisplayStates[oldPtyId];
    nextDisplayStates[newPtyId] = { ...existing, ptyId: newPtyId };

    const projectPath = existing.projectPath;
    const projectTerminals = state.terminalsByProject[projectPath] ?? [];
    const nextProjectTerminals = projectTerminals.map((id) => (id === oldPtyId ? newPtyId : id));

    set({
      displayStates: nextDisplayStates,
      terminalsByProject: {
        ...state.terminalsByProject,
        [projectPath]: nextProjectTerminals,
      },
    });
  },

  setActiveIndex: (projectPath, index) => {
    set({
      activeIndices: {
        ...get().activeIndices,
        [projectPath]: index,
      },
    });
  },

  activateLast: (projectPath) => {
    const terminals = get().terminalsByProject[projectPath] ?? [];
    if (terminals.length > 0) {
      set({
        activeIndices: {
          ...get().activeIndices,
          [projectPath]: terminals.length - 1,
        },
      });
    }
  },

  clearProject: (projectPath) => {
    const state = get();
    const ptyIds = state.terminalsByProject[projectPath] ?? [];
    const remainingDisplays = { ...state.displayStates };
    for (const id of ptyIds) {
      delete remainingDisplays[id];
    }
    const { [projectPath]: _, ...remainingProjects } = state.terminalsByProject;
    const { [projectPath]: __, ...remainingIndices } = state.activeIndices;

    set({
      displayStates: remainingDisplays,
      terminalsByProject: remainingProjects,
      activeIndices: remainingIndices,
    });
  },

  setLoadingLabel: (label) => set({ loadingLabel: label }),
}));

// ── Derived selectors ────────────────────────────────────────────────

/** Get the active ptyId for a project */
export function getActivePtyId(projectPath: string): string | undefined {
  const state = useTerminalStore.getState();
  const terminals = state.terminalsByProject[projectPath];
  if (!terminals || terminals.length === 0) return undefined;
  const index = state.activeIndices[projectPath] ?? 0;
  return terminals[index];
}

/** Get current stack page for a project */
export function getStackPage(projectPath: string): number {
  const state = useTerminalStore.getState();
  const index = state.activeIndices[projectPath] ?? 0;
  return Math.floor(index / STACK_PAGE_SIZE);
}

/** Get total stack pages for a project */
export function getTotalStackPages(projectPath: string): number {
  const state = useTerminalStore.getState();
  const terminals = state.terminalsByProject[projectPath] ?? [];
  return Math.max(1, Math.ceil(terminals.length / STACK_PAGE_SIZE));
}

/**
 * Get the terminal index for a given stack position (1-indexed).
 * Only considers terminals on the current page.
 */
export function getTerminalIndexByStackPosition(projectPath: string, stackPosition: number): number {
  const state = useTerminalStore.getState();
  const terminals = state.terminalsByProject[projectPath] ?? [];
  const currentActiveIndex = state.activeIndices[projectPath] ?? 0;
  const page = Math.floor(currentActiveIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, terminals.length);
  const pageSize = pageEnd - pageStart;

  if (terminals.length === 0) return -1;

  const backPositions: { index: number; diff: number }[] = [];
  for (let index = pageStart; index < pageEnd; index++) {
    if (index !== currentActiveIndex) {
      const diff =
        index < currentActiveIndex
          ? currentActiveIndex - index
          : pageSize - (index - pageStart) + (currentActiveIndex - pageStart);
      backPositions.push({ index, diff });
    }
  }

  backPositions.sort((a, b) => b.diff - a.diff);

  const arrayIndex = stackPosition - 1;
  if (arrayIndex >= 0 && arrayIndex < backPositions.length) {
    return backPositions[arrayIndex].index;
  }

  return -1;
}
