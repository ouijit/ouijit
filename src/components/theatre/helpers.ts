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
  // From kanbanBoard
  toggleKanbanBoard: (() => void) | null;
  // From diffPanel
  toggleActiveDiffPanel: (() => Promise<void>) | null;
  // From shipItPanel
  showShipItPanel: ((term: TheatreTerminal) => Promise<void>) | null;
  hideShipItPanel: ((term: TheatreTerminal) => void) | null;
  toggleActiveShipItPanel: (() => Promise<void>) | null;
}

export const theatreRegistry: TheatreRegistry = {
  toggleTaskIndex: null,
  refreshTaskIndex: null,
  createNewAgentShell: null,
  toggleKanbanBoard: null,
  addTheatreTerminal: null,
  closeTheatreTerminal: null,
  playOrToggleRunner: null,
  toggleActiveDiffPanel: null,
  showShipItPanel: null,
  hideShipItPanel: null,
  toggleActiveShipItPanel: null,
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
  item.innerHTML = '<i data-lucide="box"></i> Open in Sandbox';
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    onSandbox();
  });
  menu.appendChild(item);

  document.body.appendChild(menu);

  // Render lucide icons
  import('lucide').then(({ createIcons, icons }) => {
    createIcons({ icons, nameAttr: 'data-lucide', attrs: {}, nodes: [menu] });
  });

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
