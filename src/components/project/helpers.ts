/**
 * Project mode helper functions
 * Separated from state.ts to maintain clean dependency hierarchy:
 *   state.ts (types/state) <- helpers.ts (utilities) <- other modules
 */

import type { OuijitTerminal } from './terminal';
import { convertIconsIn } from '../../utils/icons';

/**
 * Cross-module function registry
 * Used to break circular dependencies - modules register their functions here,
 * allowing other modules to call them without direct imports
 */
interface ProjectRegistry {
  // From kanbanBoard
  showKanbanAndFocusInput: (() => Promise<void>) | null;
  // From terminalCards
  addProjectTerminal: ((runConfig?: unknown, options?: unknown) => Promise<boolean>) | null;
  closeProjectTerminal: ((termOrIndex: OuijitTerminal | number) => void) | null;
  playOrToggleRunner: (() => Promise<void>) | null;
  // From kanbanBoard
  toggleKanbanBoard: (() => void) | null;
  syncKanbanStatusDots: (() => void) | null;
  // From diffPanel
  toggleActiveDiffPanel: (() => Promise<void>) | null;
}

export const projectRegistry: ProjectRegistry = {
  showKanbanAndFocusInput: null,
  toggleKanbanBoard: null,
  syncKanbanStatusDots: null,
  addProjectTerminal: null,
  closeProjectTerminal: null,
  playOrToggleRunner: null,
  toggleActiveDiffPanel: null,
};

/**
 * Show a context menu for a task with "Open in Sandbox" option.
 * Calls onSandbox() when the user selects "Open in Sandbox".
 */
export function showTaskContextMenu(event: MouseEvent, onSandbox: () => void): void {
  event.preventDefault();
  event.stopPropagation();

  // Remove any existing context menu
  document.querySelector('.task-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';

  const item = document.createElement('button');
  item.className = 'task-context-menu-item';
  item.innerHTML = '<i data-icon="cube"></i> Open in Sandbox';
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    onSandbox();
  });
  menu.appendChild(item);

  document.body.appendChild(menu);

  // Render icons
  convertIconsIn(menu);

  // Position at mouse, keeping within viewport
  const x = Math.min(event.clientX, window.innerWidth - 180);
  const y = Math.min(event.clientY, window.innerHeight - 40);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Animate in
  requestAnimationFrame(() => menu.classList.add('task-context-menu--visible'));

  // Dismiss on click outside (ignore clicks inside the menu itself)
  const dismiss = (e: MouseEvent) => {
    if (menu.contains(e.target as Node)) return;
    menu.classList.remove('task-context-menu--visible');
    setTimeout(() => menu.remove(), 100);
    document.removeEventListener('mousedown', dismiss);
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

/**
 * Get the git path for a terminal (worktree path if it's a worktree, otherwise project path)
 */
export function getTerminalGitPath(term: OuijitTerminal): string {
  return term.worktreePath || term.projectPath;
}

/**
 * Hide the runner panel (does NOT kill the runner process)
 */
export function hideRunnerPanel(term: OuijitTerminal): void {
  if (!term.runnerPanelOpen) return;

  const panel = term.container.querySelector('.runner-panel') as HTMLElement;
  if (panel) {
    const wasFullWidth = term.runnerFullWidth;
    panel.classList.remove('runner-panel--visible', 'runner-panel--full');
    // Hide the resize handle so it's not interactive while collapsed
    const handle = term.container.querySelector('.runner-resize-handle') as HTMLElement;
    if (handle) handle.style.display = 'none';

    if (wasFullWidth) {
      // Full-width: skip slide animation, close instantly
      panel.style.transition = 'none';
      panel.style.flexBasis = '0';
      const cardBody = term.container.querySelector('.project-card-body');
      if (cardBody) cardBody.classList.remove('runner-split', 'runner-full');
      // Restore transition and fit after layout
      requestAnimationFrame(() => {
        panel.style.transition = '';
        term.fitAddon.fit();
        window.api.pty.resize(term.ptyId, term.xterm.cols, term.xterm.rows);
      });
    } else {
      // Split mode: animate closed via flex-basis transition
      panel.style.flexBasis = '0';
      setTimeout(() => {
        const cardBody = term.container.querySelector('.project-card-body');
        if (cardBody) cardBody.classList.remove('runner-split', 'runner-full');
        term.fitAddon.fit();
        window.api.pty.resize(term.ptyId, term.xterm.cols, term.xterm.rows);
      }, 250);
    }
  }

  // Remove active state from run button
  const runBtn = term.container.querySelector('.card-tab-run');
  if (runBtn) runBtn.classList.remove('card-tab--active');

  term.runnerPanelOpen = false;
}
