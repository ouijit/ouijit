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
