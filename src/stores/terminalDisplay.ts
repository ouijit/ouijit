import type { GitFileStatus } from '../types';
import type { TerminalPanel } from '../components/terminal/panelTypes';

/** Renderable state pushed from OuijitTerminal class to React */
export interface TerminalDisplayState {
  ptyId: string;
  label: string;
  summaryType: 'thinking' | 'ready' | 'success' | 'error';
  gitFileStatus: GitFileStatus | null;
  lastOscTitle: string;
  tags: string[];
  hookStatus: 'thinking' | 'ready' | null;
  /** Ordered tab list of user-managed panels (runner/preview/plan). */
  panels: TerminalPanel[];
  /** Id of the panel currently displayed, or null when none is open. */
  activePanelId: string | null;
  /** Whether the active panel renders full-width or split with the xterm. */
  panelFullWidth: boolean;
  /** Automatic diff takeover (header-driven, separate from the panel tabs). */
  diffPanelOpen: boolean;
  diffPanelMode: 'uncommitted' | 'worktree';
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
  summaryType: 'ready',
  gitFileStatus: null,
  lastOscTitle: '',
  tags: [],
  hookStatus: null,
  panels: [],
  activePanelId: null,
  panelFullWidth: true,
  diffPanelOpen: false,
  diffPanelMode: 'uncommitted',
  sandboxed: false,
  taskId: null,
  worktreeBranch: null,
  exited: false,
  isLoading: false,
};
