import type { TerminalDisplayState } from '../stores/terminalStore';

export type CaptureScene = 'home' | 'kanban' | 'settings' | 'terminal-stack';

export interface CaptureTerminalSeed {
  ptyId: string;
  taskId: number;
  label: string;
  summary?: string;
  summaryType?: TerminalDisplayState['summaryType'];
  worktreeBranch?: string;
  sandboxed?: boolean;
}

export interface CaptureNavigatePayload {
  scene: CaptureScene;
  projectPath?: string;
  /** Terminal display rows to seed into the store before render */
  terminalSeeds?: CaptureTerminalSeed[];
  /** Which task id (if any) should own the focused terminal stack */
  focusedTaskId?: number;
}
