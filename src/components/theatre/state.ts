/**
 * Shared state for theatre mode components
 * Centralizes state that needs to be accessed across multiple theatre modules
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { PtyId, Project, ChangedFile, CompactGitStatus, ActiveSession } from '../../types';

// Summary type for terminal status indication
export type SummaryType = 'thinking' | 'ready';

// Theatre terminal interface for multi-terminal support
export interface TheatreTerminal {
  ptyId: PtyId;
  projectPath: string;
  command: string | undefined;  // undefined = interactive shell
  label: string;  // Display name for the card
  terminal: Terminal;
  fitAddon: FitAddon;
  container: HTMLElement;
  cleanupData: (() => void) | null;
  cleanupExit: (() => void) | null;
  resizeObserver: ResizeObserver | null;
  // Summary state for dynamic status display
  summary: string;
  summaryType: SummaryType;
  lastOscTitle: string;  // Last seen OSC terminal title
  // Task support
  sandboxed: boolean;
  taskId: number | null;
  taskPrompt?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  // Per-terminal git status and diff panel state
  gitStatus: CompactGitStatus | null;
  diffPanelOpen: boolean;
  diffPanelFiles: ChangedFile[];
  diffPanelSelectedFile: string | null;
  diffPanelMode: 'uncommitted' | 'worktree';  // What the diff panel is showing
  // Runner panel state
  runnerPanelOpen: boolean;
  runnerPtyId: PtyId | null;
  runnerTerminal: Terminal | null;
  runnerFitAddon: FitAddon | null;
  runnerLabel: string;           // OCS title or command name
  runnerCommand: string | null;  // Command being run by the runner
  runnerStatus: 'running' | 'success' | 'error' | 'idle';
  runnerCleanupData: (() => void) | null;
  runnerCleanupExit: (() => void) | null;
  // Runner split layout state
  runnerFullWidth: boolean;                     // true = full width (default), false = split
  runnerSplitRatio: number;                    // 0-1, default 0.5
  runnerResizeObserver: ResizeObserver | null;  // for runner xterm container
  runnerResizeCleanup: (() => void) | null;     // cleanup for drag listeners
}

// Per-project session storage for preserving theatre mode across project switches
export interface StoredTheatreSession {
  terminals: TheatreTerminal[];
  activeIndex: number;
  projectData: Project;
  stackElement: HTMLElement;
  // Diff panel state
  diffPanelWasOpen: boolean;
  diffSelectedFile: string | null;
  diffFiles: ChangedFile[];
}

// Constants
export const STACK_PAGE_SIZE = 5;
export const HIDDEN_SESSIONS_CONTAINER_ID = 'hidden-theatre-sessions';
export const GIT_STATUS_IDLE_DELAY = 2000;
export const GIT_STATUS_PERIODIC_INTERVAL = 15000;

/**
 * Non-reactive theatre mode state
 * Items that don't need reactive updates (handlers, timers, cleanup functions)
 * Reactive state is now in signals.ts
 */
export const theatreState = {
  // Header content for restoration on exit
  originalHeaderContent: null as string | null,

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

// Session storage for preserved sessions (in-memory, survives project switching)
export const projectSessions = new Map<string, StoredTheatreSession>();

// Orphaned sessions storage (PTY sessions that survived an app refresh)
// Populated on startup from main process, consumed by enterTheatreMode
export const orphanedSessions = new Map<string, ActiveSession[]>();

/**
 * Ensures the hidden container for storing detached theatre sessions exists
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

