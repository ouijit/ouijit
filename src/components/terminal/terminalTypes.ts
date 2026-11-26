import type { Terminal as XTerminal } from '@xterm/xterm';
import type { GitFileStatus, PtyId, SandboxProviderId } from '../../types';
import type { TerminalPanel } from './panelTypes';

export interface RunnerPanelScript {
  name: string;
  command: string;
  source?: 'hook' | 'script';
  restartIfRunning?: boolean;
  sandboxProvider?: SandboxProviderId;
  env?: Record<string, string>;
  private?: boolean;
}

export interface RegisteredTerminal {
  ptyId: PtyId;
  readonly projectPath: string;
  command: string | undefined;
  readonly isRunner: boolean;
  label: string;
  tags: string[];
  readonly sandboxProvider: SandboxProviderId | undefined;
  readonly taskId: number | null;
  readonly taskPrompt?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  mergeTarget?: string;
  readonly xterm: XTerminal;
  panels: TerminalPanel[];
  activePanelId: string | null;
  panelSplitRatio: number;
  panelFullWidth: boolean;
  diffPanelOpen: boolean;
  runnerChildren: Map<string, RegisteredTerminal>;
  runnerSpawning: Set<string>;
  covered: boolean;
  diffBase?: string;
  gitFileStatus: GitFileStatus | null;

  getViewportElement(): HTMLDivElement;
  pushDisplayState(patch: Record<string, unknown>): void;
  fit(): void;
  syncPtySize(): void;
  detach(): void;
  reattach(): void;
  dispose(): void;
  getActivePanel(): TerminalPanel | null;
  updatePanel(id: string, patch: Partial<TerminalPanel>): void;
  activatePanel(id: string): void;
  deactivatePanel(): void;
  setPanelFullWidth(fullWidth: boolean): void;
  addRunnerPanel(script?: RunnerPanelScript | null, activate?: boolean): string;
  addWebPreviewPanel(url?: string | null, opts?: { activate?: boolean }): string;
  addPlanPanel(planPath: string, activate?: boolean): string;
  setDiffPanelOpen(open: boolean): void;
  revealInDiff(path: string, line: number | null): void;
  toggleDiffPanel(): void;
  setDiffBase(base: string): void;
  closePanel(id: string): void;
  setRunnerChild(panelId: string, runner: RegisteredTerminal): void;
  killRunnerChild(panelId: string): void;
  handleHookStatus(status: 'thinking' | 'ready'): void;
  setTags(tags: string[]): void;
}
