/**
 * Reactive effects for theatre mode
 * Automatically respond to signal changes without manual update calls
 */

import { effect } from '@preact/signals-core';
import {
  terminals,
  activeIndex,
  activeTerminal,
  projectPath,
} from './signals';
// Direct imports - these modules import from signals.ts, not effects.ts, so no circular dep
import { updateCardStack, updateTerminalCardLabel, showStackEmptyState, hideStackEmptyState } from './terminalCards';
import { syncDiffPanelToActiveTerminal } from './diffPanel';

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

  // Effect: Update terminal card labels when terminal summary changes
  cleanupFunctions.push(
    effect(() => {
      const _terminals = terminals.value;

      // Update all terminal card labels
      for (const term of _terminals) {
        updateTerminalCardLabel(term);
      }
    })
  );

  // Effect: Sync diff panel visibility when active terminal changes
  // Store previous active index to detect actual changes
  let previousActiveIndex = activeIndex.value;
  cleanupFunctions.push(
    effect(() => {
      const _terminals = terminals.value;
      const currentActiveIndex = activeIndex.value;
      const _projectPath = projectPath.value;

      // Only sync if we're in theatre mode and the index actually changed
      if (_projectPath && _terminals.length > 0 && currentActiveIndex !== previousActiveIndex) {
        previousActiveIndex = currentActiveIndex;
        // Sync after a brief delay to allow terminal switch animation
        requestAnimationFrame(() => {
          syncDiffPanelToActiveTerminal();
        });
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
