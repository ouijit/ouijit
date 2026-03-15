import { create } from 'zustand';
import type { CompactGitStatus, ChangedFile } from '../types';

/** Renderable state pushed from OuijitTerminal class to React */
export interface TerminalDisplayState {
  ptyId: string;
  label: string;
  summary: string;
  summaryType: 'thinking' | 'ready';
  gitStatus: CompactGitStatus | null;
  lastOscTitle: string;
  tags: string[];
  hookStatus: 'thinking' | 'ready' | null;
  runnerStatus: 'running' | 'success' | 'error' | 'idle';
  runnerPanelOpen: boolean;
  diffPanelOpen: boolean;
  diffPanelFiles: ChangedFile[];
  diffPanelSelectedFile: string | null;
  diffPanelMode: 'uncommitted' | 'worktree';
  sandboxed: boolean;
  taskId: number | null;
  worktreeBranch: string | null;
  projectPath: string;
  exited: boolean;
}

export const DEFAULT_DISPLAY_STATE: Omit<TerminalDisplayState, 'ptyId' | 'projectPath'> = {
  label: '',
  summary: '',
  summaryType: 'ready',
  gitStatus: null,
  lastOscTitle: '',
  tags: [],
  hookStatus: null,
  runnerStatus: 'idle',
  runnerPanelOpen: false,
  diffPanelOpen: false,
  diffPanelFiles: [],
  diffPanelSelectedFile: null,
  diffPanelMode: 'uncommitted',
  sandboxed: false,
  taskId: null,
  worktreeBranch: null,
  exited: false,
};

interface TerminalStoreState {
  /** Per-terminal renderable state keyed by ptyId */
  displayStates: Record<string, TerminalDisplayState>;
  /** Ordered list of terminal ptyIds per project path */
  terminalsByProject: Record<string, string[]>;
  /** Active terminal index per project path */
  activeIndices: Record<string, number>;
}

interface TerminalStoreActions {
  addTerminal: (projectPath: string, ptyId: string, initial: Partial<TerminalDisplayState>) => void;
  removeTerminal: (ptyId: string) => void;
  updateDisplay: (ptyId: string, patch: Partial<TerminalDisplayState>) => void;
  setActiveIndex: (projectPath: string, index: number) => void;
  clearProject: (projectPath: string) => void;
}

type TerminalStore = TerminalStoreState & TerminalStoreActions;

export const useTerminalStore = create<TerminalStore>()((set, get) => ({
  displayStates: {},
  terminalsByProject: {},
  activeIndices: {},

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

    set({
      displayStates: remainingDisplays,
      terminalsByProject: {
        ...state.terminalsByProject,
        [projectPath]: projectTerminals,
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

  setActiveIndex: (projectPath, index) => {
    set({
      activeIndices: {
        ...get().activeIndices,
        [projectPath]: index,
      },
    });
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
}));
