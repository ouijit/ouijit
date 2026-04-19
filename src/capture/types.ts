import type { TerminalDisplayState } from '../stores/terminalStore';

export type CaptureScene = 'kanban' | 'settings' | 'terminal-stack' | 'canvas';

export interface CaptureTerminalSeed {
  ptyId: string;
  taskId: number;
  label: string;
  summary?: string;
  summaryType?: TerminalDisplayState['summaryType'];
  worktreeBranch?: string;
  sandboxed?: boolean;
  /** Optional canned ANSI content to write into the xterm on seed */
  content?: string;
  /** Canvas layout position — only consumed by the canvas scene */
  canvasPosition?: { x: number; y: number };
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
}
