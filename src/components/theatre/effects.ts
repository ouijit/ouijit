/**
 * Reactive effects for theatre mode
 * Automatically respond to signal changes without manual update calls
 */

import { effect } from '@preact/signals-core';
import {
  terminals,
  activeIndex,
  activeTerminal,
  tasksPanelVisible,
  tasksList,
  projectPath,
} from './signals';
// Direct imports - these modules import from signals.ts, not effects.ts, so no circular dep
import { updateCardStack, updateTerminalCardLabel, showStackEmptyState, hideStackEmptyState } from './terminalCards';
import { renderTasksList } from './tasksPanel';

// Track whether effects are initialized
let effectsInitialized = false;

// Store cleanup functions for effects
const cleanupFunctions: (() => void)[] = [];

/**
 * Initialize all theatre mode effects
 * Should be called once when theatre mode is first entered
 */
export function initializeEffects(): void {
  if (effectsInitialized) return;

  // Effect: Auto-update card stack and empty state when terminals or activeIndex changes
  cleanupFunctions.push(
    effect(() => {
      // Read the signals to track dependencies
      const _terminals = terminals.value;
      const _activeIndex = activeIndex.value;
      const _projectPath = projectPath.value;

      // Only update if we're in theatre mode
      if (_projectPath) {
        if (_terminals.length > 0) {
          // Has terminals - hide empty state, update stack
          hideStackEmptyState();
          updateCardStack();
        } else {
          // No terminals - show empty state
          showStackEmptyState();
        }
      }
    })
  );

  // Effect: Focus active terminal when it changes
  cleanupFunctions.push(
    effect(() => {
      const term = activeTerminal.value;
      if (term) {
        requestAnimationFrame(() => {
          term.fitAddon.fit();
          term.terminal.focus();
        });
      }
    })
  );

  // Effect: Re-render tasks list when it changes (if panel visible)
  cleanupFunctions.push(
    effect(() => {
      const visible = tasksPanelVisible.value;
      const _tasks = tasksList.value;

      if (visible) {
        renderTasksList();
      }
    })
  );

  // Effect: Update terminal card labels when terminal summary changes
  cleanupFunctions.push(
    effect(() => {
      const _terminals = terminals.value;
      const visible = tasksPanelVisible.value;

      // Update all terminal card labels
      for (const term of _terminals) {
        updateTerminalCardLabel(term);
      }
    })
  );

  effectsInitialized = true;
}

/**
 * Clean up all effects
 * Should be called when completely shutting down theatre mode
 */
export function cleanupEffects(): void {
  for (const cleanup of cleanupFunctions) {
    cleanup();
  }
  cleanupFunctions.length = 0;
  effectsInitialized = false;
}
