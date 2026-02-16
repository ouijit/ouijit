/**
 * Centralized hotkey management using hotkeys-js
 * Provides scoped keyboard shortcuts that don't conflict across contexts
 */

import hotkeys from 'hotkeys-js';

// Platform detection
const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * Convert platform-agnostic hotkey to platform-specific format.
 * Use 'mod+' as a prefix that becomes 'command+' on Mac and 'ctrl+' on other platforms.
 *
 * Examples:
 *   'mod+n' -> 'command+n' (Mac) or 'ctrl+n' (Linux/Windows)
 *   'mod+shift+s' -> 'command+shift+s' (Mac) or 'ctrl+shift+s' (Linux/Windows)
 */
export function platformHotkey(keys: string): string {
  return keys.replace(/\bmod\+/g, isMac ? 'command+' : 'ctrl+');
}

// Define all scopes
export const Scopes = {
  APP: 'app',
  PROJECT_LIST: 'project-list',
  THEATRE: 'theatre',
  KANBAN: 'kanban',
  MODAL: 'modal',
  DROPDOWN: 'dropdown',
} as const;

type Scope = (typeof Scopes)[keyof typeof Scopes];

// Scope stack for nested contexts (modal on top of theatre, etc.)
const scopeStack: Scope[] = [Scopes.APP];

/**
 * Push a new scope onto the stack and activate it
 */
export function pushScope(scope: Scope): void {
  scopeStack.push(scope);
  hotkeys.setScope(scope);
}

/**
 * Pop the current scope and return to the previous one
 */
export function popScope(): void {
  if (scopeStack.length > 1) {
    scopeStack.pop();
    hotkeys.setScope(scopeStack[scopeStack.length - 1]);
  }
}

/**
 * Get the current active scope
 */
export function getCurrentScope(): Scope {
  return scopeStack[scopeStack.length - 1];
}

/**
 * Register a hotkey for a specific scope
 */
export function registerHotkey(
  keys: string,
  scope: Scope,
  callback: (event: KeyboardEvent) => void
): void {
  hotkeys(keys, { scope }, (event) => {
    event.preventDefault();
    callback(event);
  });
}

/**
 * Unregister a hotkey
 */
export function unregisterHotkey(keys: string, scope: Scope): void {
  hotkeys.unbind(keys, scope);
}

/**
 * Configure hotkeys-js to work in input fields when needed
 * By default, hotkeys-js ignores events from input/textarea/select
 */
export function initHotkeys(): void {
  // Allow hotkeys in inputs only for specific keys
  hotkeys.filter = (event) => {
    const target = event.target as HTMLElement;
    const tagName = target.tagName;
    const isInput =
      tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';

    // Check if we have a modifier key (⌘ on Mac, Ctrl on Linux/Windows)
    const hasModifier = isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

    // Terminal handling: allow modifier shortcuts, but let raw keys pass to the shell
    const isTerminal = target.closest('.xterm');
    if (isTerminal) {
      // Allow modifier shortcuts (Cmd+N, Cmd+W, etc.) even in terminal
      return hasModifier && !event.altKey;
    }

    // Check if we're in a modal context (dialogs that need Escape to close)
    const isInModal = target.closest('.modal-overlay');

    // Allow Escape and Enter through for modal dialogs
    if ((event.key === 'Escape' || event.key === 'Enter') && isInModal) {
      return true;
    }

    // Allow modifier+key shortcuts in inputs
    if (hasModifier && !event.altKey) {
      return true;
    }

    // Block other hotkeys when in input fields
    return !isInput;
  };
}
