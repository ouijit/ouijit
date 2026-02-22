/**
 * Reactive effects for project mode
 * Automatically respond to signal changes without manual update calls
 */

import { effect } from '@preact/signals-core';
import {
  terminals,
  activeIndex,
  activeTerminal,
  projectPath,
  taskVersion,
  kanbanVisible,
} from './signals';
// Direct imports - these modules import from signals.ts, not effects.ts, so no circular dep
import { updateCardStack, showStackEmptyState, hideStackEmptyState, updateTerminalCardLabel } from './terminalCards';
import { syncDiffPanelToActiveTerminal } from './diffPanel';
import { refreshKanbanBoard, syncKanbanStatusDots, showKanbanBoard } from './kanbanBoard';

// Track whether effects are initialized
let effectsInitialized = false;

// Store cleanup functions for effects
const cleanupFunctions: (() => void)[] = [];

/**
 * Initialize all project mode effects
 * Should be called once when project mode is first entered
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

      // Only update if we're in project mode
      if (_projectPath) {
        if (_terminals.length > 0) {
          // Has terminals - hide empty state, update stack
          hideStackEmptyState();
          updateCardStack();
        } else {
          // No terminals - go back to kanban board
          showKanbanBoard();
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

  // Effect: Sync diff panel visibility when active terminal changes
  // Store previous active index to detect actual changes
  let previousActiveIndex = activeIndex.value;
  cleanupFunctions.push(
    effect(() => {
      const _terminals = terminals.value;
      const currentActiveIndex = activeIndex.value;
      const _projectPath = projectPath.value;

      // Only sync if we're in project mode and the index actually changed
      if (_projectPath && _terminals.length > 0 && currentActiveIndex !== previousActiveIndex) {
        previousActiveIndex = currentActiveIndex;
        // Sync after a brief delay to allow terminal switch animation
        requestAnimationFrame(() => {
          syncDiffPanelToActiveTerminal();
        });
      }
    })
  );

  // Effect: Auto-refresh kanban board when taskVersion bumps
  let lastTaskVersionForKanban = taskVersion.value;
  cleanupFunctions.push(
    effect(() => {
      const ver = taskVersion.value;
      const visible = kanbanVisible.value;
      if (ver !== lastTaskVersionForKanban && visible) {
        lastTaskVersionForKanban = ver;
        refreshKanbanBoard();
      }
      lastTaskVersionForKanban = ver;
    })
  );

  // Effect: Sync kanban status dots when terminals are added/removed
  cleanupFunctions.push(
    effect(() => {
      const _terminals = terminals.value; // subscribe to terminal list changes
      const visible = kanbanVisible.value;
      if (visible) {
        // Use void to ensure the subscription triggers even if sync is a no-op
        void _terminals.length;
        syncKanbanStatusDots();
      }
    })
  );

  // Effect: Sync terminal card labels when taskVersion bumps (e.g. task renamed)
  let lastTaskVersionForLabels = taskVersion.value;
  cleanupFunctions.push(
    effect(() => {
      const ver = taskVersion.value;
      const path = projectPath.value;
      const currentTerminals = terminals.value;
      if (ver !== lastTaskVersionForLabels && path) {
        lastTaskVersionForLabels = ver;
        const taskTerminals = currentTerminals.filter(t => t.taskId != null);
        if (taskTerminals.length > 0) {
          window.api.task.getAll(path).then(tasks => {
            const taskMap = new Map(tasks.map(t => [t.taskNumber, t]));
            for (const term of taskTerminals) {
              const task = taskMap.get(term.taskId!);
              if (task && task.name !== term.label) {
                term.label = task.name;
                updateTerminalCardLabel(term);
              }
            }
          });
        }
      }
      lastTaskVersionForLabels = ver;
    })
  );

  effectsInitialized = true;
}

/**
 * Clean up all effects
 * Should be called when completely shutting down project mode
 */
export function cleanupEffects(): void {
  for (const cleanup of cleanupFunctions) {
    cleanup();
  }
  cleanupFunctions.length = 0;
  effectsInitialized = false;
}
