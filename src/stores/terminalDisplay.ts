import type { GitFileStatus, SandboxProviderId } from '../types';
import type { TerminalPanel } from '../components/terminal/panelTypes';

export type TerminalStatus = 'thinking' | 'ready' | 'success' | 'error';

/** Renderable state pushed from OuijitTerminal class to React */
export interface TerminalDisplayState {
  ptyId: string;
  label: string;
  status: TerminalStatus;
  /** Epoch ms; `updateDisplay` moves it whenever `status` changes. */
  statusSince: number;
  /** Epoch ms when the terminal last stopped being viewed. */
  lastViewedAt: number;
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
  /** Which backend runs the terminal (undefined = host); `isActiveSandbox` derives the boolean. */
  sandboxProvider?: SandboxProviderId;
  taskId: number | null;
  worktreeBranch: string | null;
  projectPath: string;
  exited: boolean;
  /** Placeholder slot for an in-flight task start. Card renders the loading
   *  body; the slot will be rekey'd + flag cleared when the real PTY spawns. */
  isLoading: boolean;
}

export const DEFAULT_DISPLAY_STATE: Omit<
  TerminalDisplayState,
  'ptyId' | 'projectPath' | 'statusSince' | 'lastViewedAt'
> = {
  label: '',
  status: 'ready',
  gitFileStatus: null,
  lastOscTitle: '',
  tags: [],
  hookStatus: null,
  panels: [],
  activePanelId: null,
  panelFullWidth: true,
  diffPanelOpen: false,
  taskId: null,
  worktreeBranch: null,
  exited: false,
  isLoading: false,
};

/** Only `ready`: a shell command that finished is not news. */
export function isUnread(t: TerminalDisplayState, viewedPtyId: string | undefined): boolean {
  return t.status === 'ready' && t.statusSince > t.lastViewedAt && t.ptyId !== viewedPtyId;
}
