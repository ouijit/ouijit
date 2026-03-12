/**
 * Reactive state management for project mode using Preact Signals
 * Replaces manual update choreography and callback patterns
 *
 * NOTE: Terminal collection signals (terminals, activeIndex, activeTerminal,
 * activeStackPage, totalStackPages) have moved to TerminalManager.
 */

import { signal, computed } from '@preact/signals-core';
import type { Project, ChangedFile } from '../../types';

// Core reactive state
export const projectPath = signal<string | null>(null);
export const projectData = signal<Project | null>(null);

// Derived state
export const isInProjectMode = computed(() => projectPath.value !== null);

// Panel visibility
export const diffPanelVisible = signal(false);
export const diffPanelFiles = signal<ChangedFile[]>([]);
export const diffPanelSelectedFile = signal<string | null>(null);
export const diffPanelMode = signal<'uncommitted' | 'worktree'>('uncommitted');
export const diffPanelTaskId = signal<number | null>(null);

// Dropdown visibility
export const gitDropdownVisible = signal(false);
export const launchDropdownVisible = signal(false);
export const sandboxDropdownVisible = signal(false);

// Kanban board visibility
export const kanbanVisible = signal(false);

// Home view state
export const homeViewActive = signal(false);

// Task list invalidation (effects watch this to auto-refresh views)
const taskVersion = signal(0);
export { taskVersion };

/** Call after any task mutation (create, close, delete, reopen) to refresh views */
export function invalidateTaskList(): void {
  taskVersion.value++;
}

/**
 * Reset all signals to initial values
 * Call this when exiting project mode
 */
export function resetSignals(): void {
  projectPath.value = null;
  projectData.value = null;
  diffPanelVisible.value = false;
  diffPanelFiles.value = [];
  diffPanelSelectedFile.value = null;
  diffPanelMode.value = 'uncommitted';
  diffPanelTaskId.value = null;
  gitDropdownVisible.value = false;
  launchDropdownVisible.value = false;
  sandboxDropdownVisible.value = false;
  kanbanVisible.value = false;
  homeViewActive.value = false;
  taskVersion.value = 0;
}
