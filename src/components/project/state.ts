/**
 * Shared state for project mode components
 * Centralizes state that needs to be accessed across multiple project modules
 */

// Summary type for terminal status indication
export type SummaryType = 'thinking' | 'ready';

// Constants
export const STACK_PAGE_SIZE = 5;
export const HIDDEN_SESSIONS_CONTAINER_ID = 'hidden-project-sessions';
export const GIT_STATUS_IDLE_DELAY = 3000;
export const GIT_STATUS_PERIODIC_INTERVAL = 30000;

/**
 * Non-reactive project mode state
 * Items that don't need reactive updates (handlers, timers, cleanup functions)
 * Reactive state is now in signals.ts
 */
export const projectState = {
  // Keyboard handler reference
  escapeKeyHandler: null as ((e: KeyboardEvent) => void) | null,

  // Git status refresh timers
  gitStatusIdleTimeout: null as ReturnType<typeof setTimeout> | null,
  gitStatusPeriodicInterval: null as ReturnType<typeof setInterval> | null,
  lastTerminalOutputTime: 0,

  // Cleanup functions for dropdowns (not reactive)
  gitDropdownCleanup: null as (() => void) | null,
  diffFileDropdownCleanup: null as (() => void) | null,
  launchDropdownCleanup: null as (() => void) | null,
  sandboxDropdownCleanup: null as (() => void) | null,

  // Cleanup function for kanban board
  kanbanCleanup: null as (() => void) | null,
};

/**
 * Ensures the hidden container for storing detached project sessions exists
 */
export function ensureHiddenSessionsContainer(): HTMLElement {
  let container = document.getElementById(HIDDEN_SESSIONS_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = HIDDEN_SESSIONS_CONTAINER_ID;
    container.style.display = 'none';
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.width = '0';
    container.style.height = '0';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);
  }
  return container;
}
