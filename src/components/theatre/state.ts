/**
 * Shared state for theatre mode components
 * Centralizes state that needs to be accessed across multiple theatre modules
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { PtyId, Project, ChangedFile, Task } from '../../types';

// Summary type for terminal status indication
export type SummaryType = 'error' | 'listening' | 'building' | 'watching' | 'thinking' | 'idle';

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
  outputBuffer: string;
  lastOscTitle: string;  // Last seen OSC terminal title
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
  // Tasks panel state
  tasksPanelWasOpen: boolean;
}

// Constants
export const MAX_THEATRE_TERMINALS = 5;
export const HIDDEN_SESSIONS_CONTAINER_ID = 'hidden-theatre-sessions';
export const GIT_STATUS_IDLE_DELAY = 500;
export const GIT_STATUS_PERIODIC_INTERVAL = 5000;

// Theatre mode core state
export const theatreState = {
  // Core theatre mode
  projectPath: null as string | null,
  projectData: null as Project | null,
  originalHeaderContent: null as string | null,
  escapeKeyHandler: null as ((e: KeyboardEvent) => void) | null,

  // Terminal management
  terminals: [] as TheatreTerminal[],
  activeIndex: 0,

  // Git status refresh state
  gitStatusIdleTimeout: null as ReturnType<typeof setTimeout> | null,
  gitStatusPeriodicInterval: null as ReturnType<typeof setInterval> | null,
  lastTerminalOutputTime: 0,

  // Git dropdown state
  gitDropdownVisible: false,
  gitDropdownCleanup: null as (() => void) | null,

  // Diff panel state
  diffPanelVisible: false,
  diffPanelSelectedFile: null as string | null,
  diffPanelFiles: [] as ChangedFile[],
  diffFileDropdownVisible: false,
  diffFileDropdownCleanup: null as (() => void) | null,

  // Launch dropdown state
  launchDropdownVisible: false,
  launchDropdownCleanup: null as (() => void) | null,

  // Tasks panel state
  tasksPanelVisible: false,
  tasksList: [] as Task[],
};

// Session storage for preserved sessions
export const projectSessions = new Map<string, StoredTheatreSession>();

// Task-terminal association: maps task ID to ptyId
export const taskTerminalMap = new Map<string, PtyId>();

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

/**
 * Reset theatre state to initial values
 */
export function resetTheatreState(): void {
  theatreState.projectPath = null;
  theatreState.projectData = null;
  theatreState.originalHeaderContent = null;
  theatreState.escapeKeyHandler = null;
  theatreState.terminals = [];
  theatreState.activeIndex = 0;
  theatreState.diffPanelVisible = false;
  theatreState.diffPanelSelectedFile = null;
  theatreState.diffPanelFiles = [];
  theatreState.tasksPanelVisible = false;
  theatreState.tasksList = [];
}
