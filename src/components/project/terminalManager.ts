/**
 * TerminalManager — singleton that owns the project-mode terminal collection.
 * Replaces the `terminals` signal, `projectSessions` Map,
 * `orphanedSessions` Map, and the effects from effects.ts.
 */

import { signal, computed, effect } from '@preact/signals-core';
import type { ReadonlySignal } from '@preact/signals-core';
import type { Project, ChangedFile, ActiveSession } from '../../types';
import { OuijitTerminal } from './terminal';
import { STACK_PAGE_SIZE, ensureHiddenSessionsContainer } from './state';
import {
  projectPath,
  projectData,
  taskVersion,
  kanbanVisible,
  diffPanelVisible,
  diffPanelFiles,
  diffPanelSelectedFile,
  homeViewActive,
} from './signals';
import { syncDiffPanelToActiveTerminal } from './diffPanel';
import { refreshKanbanBoard, syncKanbanStatusDots } from './kanbanBoard';
import { updateCardStack, showStackEmptyState, hideStackEmptyState } from './terminalCards';
import { scrollSafeFit } from './terminal';

/**
 * Stored session for preserving project state across project switches
 */
export interface StoredSession {
  terminals: OuijitTerminal[];
  activeIndex: number;
  projectData: Project;
  stackElement: HTMLElement;
  kanbanWasVisible: boolean;
  diffPanelWasOpen: boolean;
  diffSelectedFile: string | null;
  diffFiles: ChangedFile[];
}

/**
 * TerminalManager singleton
 */
class TerminalManager {
  private static instance: TerminalManager | null = null;

  // ── The canonical terminal collection ───────────────────────────────
  readonly terminals = signal<OuijitTerminal[]>([]);
  readonly activeIndex = signal(0);

  // ── Computed signals ────────────────────────────────────────────────
  readonly activeTerminal: ReadonlySignal<OuijitTerminal | null>;
  readonly activeStackPage: ReadonlySignal<number>;
  readonly totalStackPages: ReadonlySignal<number>;

  // ── Session preservation ────────────────────────────────────────────
  readonly sessions = new Map<string, StoredSession>();
  readonly orphanedSessions = new Map<string, ActiveSession[]>();

  // ── Effects cleanup ─────────────────────────────────────────────────
  private effectCleanups: (() => void)[] = [];

  private constructor() {
    this.activeTerminal = computed(() =>
      this.terminals.value[this.activeIndex.value] ?? null
    );
    this.activeStackPage = computed(() =>
      Math.floor(this.activeIndex.value / STACK_PAGE_SIZE)
    );
    this.totalStackPages = computed(() =>
      Math.max(1, Math.ceil(this.terminals.value.length / STACK_PAGE_SIZE))
    );
  }

  static getInstance(): TerminalManager {
    if (!TerminalManager.instance) {
      TerminalManager.instance = new TerminalManager();
    }
    return TerminalManager.instance;
  }

  // ── Collection management ───────────────────────────────────────────

  /**
   * Add a terminal to the collection.
   * Wires close and click handlers.
   */
  add(terminal: OuijitTerminal): void {
    terminal.setCloseHandler(() => this.remove(terminal));
    terminal.setClickHandler(() => this.switchTo(terminal));
    terminal.setProjectNameGetter(() => projectData.value?.name ?? 'Ouijit');

    this.terminals.value = [...this.terminals.value, terminal];
  }

  /**
   * Remove a terminal from the collection and dispose it.
   */
  remove(terminal: OuijitTerminal): void {
    const currentTerminals = this.terminals.value;
    const index = currentTerminals.indexOf(terminal);
    if (index === -1) return;

    terminal.dispose();

    const newTerminals = currentTerminals.filter((_, i) => i !== index);
    this.terminals.value = newTerminals;

    if (newTerminals.length === 0) {
      this.activeIndex.value = 0;
      return;
    }

    // Adjust active index
    const currentActive = this.activeIndex.value;
    if (currentActive >= newTerminals.length) {
      this.activeIndex.value = newTerminals.length - 1;
    } else if (index < currentActive) {
      this.activeIndex.value = currentActive - 1;
    }
  }

  /**
   * Switch to a specific terminal
   */
  switchTo(terminal: OuijitTerminal): void {
    const index = this.terminals.value.indexOf(terminal);
    if (index !== -1 && index !== this.activeIndex.value) {
      this.activeIndex.value = index;
    }
  }

  /**
   * Switch to a specific index
   */
  switchToIndex(index: number): void {
    const currentTerminals = this.terminals.value;
    if (index < 0 || index >= currentTerminals.length || index === this.activeIndex.value) return;
    this.activeIndex.value = index;
  }

  /**
   * Set the active index to the last terminal (for newly added terminals)
   */
  activateLast(): void {
    const len = this.terminals.value.length;
    if (len > 0) {
      this.activeIndex.value = len - 1;
    }
  }

  /**
   * Find a terminal by its PTY ID
   */
  findByPtyId(ptyId: string): OuijitTerminal | undefined {
    return this.terminals.value.find(t => t.ptyId === ptyId);
  }

  // ── Session preservation ────────────────────────────────────────────

  /**
   * Preserve the current project's terminals as a stored session.
   * Detaches all terminals and moves them to a hidden container.
   */
  preserveSession(path: string): void {
    const projectTerminals = this.terminals.value.filter(t => t.projectPath === path);
    if (projectTerminals.length === 0 || !projectData.value) return;

    // Detach all terminals (disconnects resize observers, clears throttles)
    for (const term of projectTerminals) {
      term.detach();
    }

    // Get or create the stack element
    const stack = document.querySelector('.project-stack') as HTMLElement;
    if (!stack) return;

    const hiddenContainer = ensureHiddenSessionsContainer();
    hiddenContainer.appendChild(stack);

    this.sessions.set(path, {
      terminals: [...projectTerminals],
      activeIndex: this.activeIndex.value,
      projectData: projectData.value,
      stackElement: stack,
      kanbanWasVisible: kanbanVisible.value,
      diffPanelWasOpen: diffPanelVisible.value,
      diffSelectedFile: diffPanelSelectedFile.value,
      diffFiles: [...diffPanelFiles.value],
    });

    // Remove project terminals from active collection
    this.terminals.value = this.terminals.value.filter(
      t => t.projectPath !== path
    );
    this.activeIndex.value = 0;
  }

  /**
   * Check if a session exists for a project path
   */
  hasSession(path: string): boolean {
    return this.sessions.has(path);
  }

  /**
   * Get a stored session
   */
  getSession(path: string): StoredSession | undefined {
    return this.sessions.get(path);
  }

  /**
   * Restore a preserved session back to the active collection.
   * Returns the session data for the caller to handle view-specific setup.
   */
  restoreSession(path: string): StoredSession | undefined {
    const session = this.sessions.get(path);
    if (!session) return undefined;

    // Add terminals back to active collection (wires close/click/name handlers)
    for (const term of session.terminals) {
      this.add(term);
    }
    this.activeIndex.value = session.activeIndex;

    // Reattach terminals (reconnects resize observers)
    for (const term of session.terminals) {
      term.reattach();
    }

    this.sessions.delete(path);
    return session;
  }

  /**
   * Permanently destroy a stored session.
   * Kills all PTYs and removes all DOM.
   */
  destroySession(path: string): void {
    const session = this.sessions.get(path);
    if (!session) return;

    for (const term of session.terminals) {
      term.dispose(); // Handles runner cleanup too
    }

    session.stackElement.remove();
    this.sessions.delete(path);
  }

  /**
   * Get list of projects with preserved sessions
   */
  getPreservedSessionPaths(): string[] {
    return Array.from(this.sessions.keys());
  }

  // ── Reactive effects ────────────────────────────────────────────────

  /**
   * Initialize reactive effects.
   * Call once when project mode is first entered.
   */
  initializeEffects(): void {
    // Clean up any existing effects before re-initializing
    this.cleanupEffects();

    // Effect: Auto-update card stack when terminals or activeIndex changes
    this.effectCleanups.push(
      effect(() => {
        const _terminals = this.terminals.value;
        const _activeIndex = this.activeIndex.value;
        const _projectPath = projectPath.value;
        const _homeView = homeViewActive.value;

        // Home view manages its own rendering; only handle project mode here
        if (!_homeView && _projectPath) {
          if (_terminals.length > 0) {
            hideStackEmptyState();
            updateCardStack();
          } else {
            showStackEmptyState();
          }
        }
      })
    );

    // Effect: Focus active terminal when it changes
    this.effectCleanups.push(
      effect(() => {
        const term = this.activeTerminal.value;
        if (term) {
          requestAnimationFrame(() => {
            scrollSafeFit(term.xterm, term.fitAddon);
            term.xterm.focus();
          });
        }
      })
    );

    // Effect: Sync diff panel visibility when active terminal changes
    let previousActiveIndex = this.activeIndex.value;
    this.effectCleanups.push(
      effect(() => {
        const _terminals = this.terminals.value;
        const currentActiveIndex = this.activeIndex.value;
        const _projectPath = projectPath.value;

        if (_projectPath && _terminals.length > 0 && currentActiveIndex !== previousActiveIndex) {
          previousActiveIndex = currentActiveIndex;
          requestAnimationFrame(() => {
            syncDiffPanelToActiveTerminal();
          });
        }
      })
    );

    // Effect: Auto-refresh kanban board when taskVersion bumps
    let lastTaskVersionForKanban = taskVersion.value;
    this.effectCleanups.push(
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
    this.effectCleanups.push(
      effect(() => {
        const _terminals = this.terminals.value;
        const visible = kanbanVisible.value;
        if (visible) {
          void _terminals.length;
          syncKanbanStatusDots();
        }
      })
    );

    // Effect: Sync terminal card labels when taskVersion bumps (e.g. task renamed)
    let lastTaskVersionForLabels = taskVersion.value;
    this.effectCleanups.push(
      effect(() => {
        const ver = taskVersion.value;
        const path = projectPath.value;
        const currentTerminals = this.terminals.value;
        if (ver !== lastTaskVersionForLabels && path) {
          lastTaskVersionForLabels = ver;
          const taskTerminals = currentTerminals.filter(t => t.taskId != null);
          if (taskTerminals.length > 0) {
            window.api.task.getAll(path).then(tasks => {
              const taskMap = new Map(tasks.map(t => [t.taskNumber, t]));
              for (const term of taskTerminals) {
                const task = taskMap.get(term.taskId!);
                if (task && task.name !== term.label.value) {
                  term.label.value = task.name;
                  // label effect on Terminal auto-updates DOM
                }
              }
            });
          }
        }
        lastTaskVersionForLabels = ver;
      })
    );

  }

  /**
   * Clean up all effects
   */
  cleanupEffects(): void {
    for (const cleanup of this.effectCleanups) {
      cleanup();
    }
    this.effectCleanups.length = 0;
  }

  // ── Hook status listener ────────────────────────────────────────────

  private hookStatusCleanup: (() => void) | null = null;

  /**
   * Register a global listener for Claude Code hook status events.
   * Maps ptyId → Terminal and updates summaryType via the terminal's handler.
   */
  registerHookStatusListener(): void {
    if (this.hookStatusCleanup) return;

    this.hookStatusCleanup = window.api.claudeHooks.onStatus((ptyId, status) => {
      const term = this.findByPtyId(ptyId);
      if (!term) return;
      term.handleHookStatus(status as 'thinking' | 'ready');
    });
  }

  /**
   * Unregister the global hook status listener
   */
  unregisterHookStatusListener(): void {
    if (this.hookStatusCleanup) {
      this.hookStatusCleanup();
      this.hookStatusCleanup = null;
    }
    // Clear all idle timers on all terminals
    for (const term of this.terminals.value) {
      term.clearIdleTimer();
    }
  }

  // ── Utility ─────────────────────────────────────────────────────────

  /**
   * Get the terminal index for a given stack position (1-indexed).
   * Only considers terminals on the current page.
   */
  getTerminalIndexByStackPosition(stackPosition: number): number {
    const currentTerminals = this.terminals.value;
    const currentActiveIndex = this.activeIndex.value;
    const page = this.activeStackPage.value;
    const pageStart = page * STACK_PAGE_SIZE;
    const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, currentTerminals.length);
    const pageSize = pageEnd - pageStart;

    if (currentTerminals.length === 0) return -1;

    const backPositions: { index: number; diff: number }[] = [];
    for (let index = pageStart; index < pageEnd; index++) {
      if (index !== currentActiveIndex) {
        const diff = index < currentActiveIndex
          ? currentActiveIndex - index
          : pageSize - (index - pageStart) + (currentActiveIndex - pageStart);
        backPositions.push({ index, diff });
      }
    }

    backPositions.sort((a, b) => b.diff - a.diff);

    const arrayIndex = stackPosition - 1;
    if (arrayIndex >= 0 && arrayIndex < backPositions.length) {
      return backPositions[arrayIndex].index;
    }

    return -1;
  }

  /**
   * Navigate to an adjacent page
   */
  navigateStackPage(direction: -1 | 1): void {
    const page = this.activeStackPage.value;
    const pages = this.totalStackPages.value;
    const targetPage = page + direction;

    if (targetPage < 0 || targetPage >= pages) return;

    const targetIndex = targetPage * STACK_PAGE_SIZE;
    if (targetIndex >= 0 && targetIndex < this.terminals.value.length) {
      this.activeIndex.value = targetIndex;
    }
  }

  /**
   * Select item at stack position (1-indexed)
   */
  selectByStackPosition(position: number): void {
    if (this.terminals.value.length === 0) return;
    const targetIndex = this.getTerminalIndexByStackPosition(position);
    if (targetIndex !== -1) {
      this.switchToIndex(targetIndex);
    }
  }
}

/** Get the singleton TerminalManager instance */
export function getManager(): TerminalManager {
  return TerminalManager.getInstance();
}

export { TerminalManager };
