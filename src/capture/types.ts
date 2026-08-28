import type { TerminalDisplayState } from '../stores/terminalStore';
import type { LensGroup } from '../lens/lens';

export type CaptureScene =
  | 'kanban'
  | 'settings'
  | 'terminal-stack'
  | 'canvas'
  | 'palette'
  | 'diff'
  | 'lens'
  | 'markdown'
  | 'preview'
  | 'resume';

export interface CaptureTerminalSeed {
  ptyId: string;
  taskId: number;
  label: string;
  summaryType?: TerminalDisplayState['summaryType'];
  worktreeBranch?: string;
  worktreePath?: string;
  sandboxed?: boolean;
  /** Optional canned ANSI content to write into the xterm on seed */
  content?: string;
  /** Canvas layout position — only consumed by the canvas scene */
  canvasPosition?: { x: number; y: number };
  /** Open the plan panel alongside the terminal when true */
  planPath?: string;
  planPanelOpen?: boolean;
}

export interface CaptureNavigatePayload {
  scene: CaptureScene;
  projectPath?: string;
  /** Terminal display rows to seed into the store before render */
  terminalSeeds?: CaptureTerminalSeed[];
  /** Which task id (if any) should own the focused terminal stack */
  focusedTaskId?: number;
  /** Canvas scene viewport (pan + zoom) */
  canvasViewport?: { x: number; y: number; zoom: number };
  /** Terminal whose diff takeover opens — only consumed by the diff scene */
  diffPtyId?: string;
  /** Note composer opened on the diff line containing `lineText` — only consumed by the diff scene */
  diffNote?: { path: string; lineText: string; body: string };
  /**
   * A lens saved over the worktree's change before the pane opens — only
   * consumed by the lens scene. The screenshots cannot spawn the agent that
   * would normally write one, so the grouping is handed over ready-made.
   */
  diffLens?: {
    name: string;
    instruction: string;
    worktreePath: string;
    /** What the pane compares against, or the key will not be the one it reads. */
    base: string | null;
    branch: string | null;
    groups: LensGroup[];
  };
  /** URL and terminal for the web preview panel — only consumed by the preview scene */
  previewUrl?: string;
  previewPtyId?: string;
  /** Theme rendered for this shot (via previewTheme, never persisted) */
  theme?: string;
}
