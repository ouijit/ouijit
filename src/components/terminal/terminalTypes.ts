import type { Terminal as XTerminal } from '@xterm/xterm';
import type { GitFileStatus, PtyId } from '../../types';
import type { SandboxBackendId, SandboxPlacement } from '../../sandbox/types';
import type { ChatAgentId } from '../../chat/model';
import type { TaskSurface } from '../../chat/preferences';
import type { TerminalPanel } from './panelTypes';

export interface RunnerPanelScript {
  name: string;
  command: string;
  source?: 'hook' | 'script';
  restartIfRunning?: boolean;
  sandbox?: SandboxPlacement;
  env?: Record<string, string>;
  private?: boolean;
  shell?: boolean;
  askedBy?: string;
}

export interface RegisteredTerminal {
  ptyId: PtyId;
  readonly projectPath: string;
  command: string | undefined;
  readonly isRunner: boolean;
  readonly surface: TaskSurface;
  readonly chatAgent: ChatAgentId | null;
  chatFocus: (() => void) | null;
  label: string;
  tags: string[];
  sandbox: SandboxPlacement | undefined;
  readonly sandboxProvider: SandboxBackendId | undefined;
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
  focus(): void;
  setAgentStatus(status: 'thinking' | 'ready' | 'error'): void;
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
  addRunnerPanel(script?: RunnerPanelScript | null, activate?: boolean, replacing?: string): string;
  addBrowserPanel(url?: string | null, opts?: { activate?: boolean; replacing?: string }): string;
  addPlanPanel(planPath: string, activate?: boolean, replacing?: string): string;
  addNewTabPanel(): string;
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
