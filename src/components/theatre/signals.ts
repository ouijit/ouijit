/**
 * Reactive state management for theatre mode using Preact Signals
 * Replaces manual update choreography and callback patterns
 */

import { signal, computed } from '@preact/signals-core';
import type { Project, ChangedFile } from '../../types';
import type { TheatreTerminal } from './state';

// Core reactive state
export const projectPath = signal<string | null>(null);
export const projectData = signal<Project | null>(null);
export const terminals = signal<TheatreTerminal[]>([]);
export const activeIndex = signal(0);

// Derived state (auto-updates when dependencies change)
export const activeTerminal = computed(() =>
  terminals.value[activeIndex.value] ?? null
);

export const isInTheatreMode = computed(() =>
  projectPath.value !== null
);

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
export const diffFileDropdownVisible = signal(false);

// Task index panel visibility
export const taskIndexVisible = signal(false);

// Kanban board visibility
export const kanbanVisible = signal(false);

// Task list invalidation (effects watch this to auto-refresh views)
const taskVersion = signal(0);
export { taskVersion };

/** Call after any task mutation (create, close, delete, reopen) to refresh views */
export function invalidateTaskList(): void {
  taskVersion.value++;
}

/**
 * Reset all signals to initial values
 * Call this when exiting theatre mode
 */
export function resetSignals(): void {
  projectPath.value = null;
  projectData.value = null;
  terminals.value = [];
  activeIndex.value = 0;
  diffPanelVisible.value = false;
  diffPanelFiles.value = [];
  diffPanelSelectedFile.value = null;
  diffPanelMode.value = 'uncommitted';
  diffPanelTaskId.value = null;
  gitDropdownVisible.value = false;
  launchDropdownVisible.value = false;
  sandboxDropdownVisible.value = false;
  diffFileDropdownVisible.value = false;
  taskIndexVisible.value = false;
  kanbanVisible.value = false;
  taskVersion.value = 0;
}
