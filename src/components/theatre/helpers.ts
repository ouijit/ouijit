/**
 * Theatre mode helper functions
 * Separated from state.ts to maintain clean dependency hierarchy:
 *   state.ts (types/state) <- helpers.ts (utilities) <- other modules
 */

import type { TheatreTerminal } from './state';

/**
 * Cross-module function registry
 * Used to break circular dependencies - modules register their functions here,
 * allowing other modules to call them without direct imports
 */
interface TheatreRegistry {
  // From taskIndex
  toggleTaskIndex: (() => void) | null;
  refreshTaskIndex: (() => Promise<void>) | null;
  // From worktreeDropdown
  createNewAgentShell: (() => void) | null;
  // From terminalCards
  addTheatreTerminal: ((runConfig?: unknown, options?: unknown) => Promise<boolean>) | null;
  closeTheatreTerminal: ((index: number) => void) | null;
  playOrToggleRunner: (() => Promise<void>) | null;
  // From diffPanel
  toggleActiveDiffPanel: (() => Promise<void>) | null;
}

export const theatreRegistry: TheatreRegistry = {
  toggleTaskIndex: null,
  refreshTaskIndex: null,
  createNewAgentShell: null,
  addTheatreTerminal: null,
  closeTheatreTerminal: null,
  playOrToggleRunner: null,
  toggleActiveDiffPanel: null,
};

/**
 * Get the git path for a terminal (worktree path if it's a worktree, otherwise project path)
 */
export function getTerminalGitPath(term: TheatreTerminal): string {
  return term.worktreePath || term.projectPath;
}

/**
 * Hide the runner panel (does NOT kill the runner process)
 */
export function hideRunnerPanel(term: TheatreTerminal): void {
  if (!term.runnerPanelOpen) return;

  const panel = term.container.querySelector('.runner-panel');
  if (panel) {
    panel.classList.remove('runner-panel--visible');
  }

  term.container.classList.remove('runner-panel-open');
  term.runnerPanelOpen = false;

  // Refit main terminal after animation
  setTimeout(() => {
    term.fitAddon.fit();
    window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
  }, 250);
}
