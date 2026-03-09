/**
 * Terminal class — encapsulates xterm instance, PTY lifecycle, DOM card,
 * signal-based display state, and runner (as child Terminal).
 *
 * Replaces the old ProjectTerminal interface with behavior-owning abstraction.
 */

import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { signal, effect } from '@preact/signals-core';
import type { Signal } from '@preact/signals-core';
import type { PtyId, ChangedFile, CompactGitStatus } from '../../types';
import type { SummaryType } from './state';
import { projectRegistry } from './helpers';
import { convertIconsIn } from '../../utils/icons';
import { escapeHtml } from '../../utils/html';
import { addTooltip, convertTitlesIn } from '../../utils/tooltip';
import { refreshTerminalGitStatus, buildCardGitBranchHtml, buildCardGitStatsHtml, scheduleTerminalGitStatusRefresh } from './gitStatus';
import { toggleTerminalDiffPanel, toggleTerminalWorktreeDiffPanel } from './diffPanel';
import { notifyReady, readyBody } from '../../utils/notifications';
import log from 'electron-log/renderer';

const terminalLog = log.scope('terminal');

// Platform detection for shortcuts display
const isMac = navigator.platform.toLowerCase().includes('mac');

// ── Idle fallback timer constants ────────────────────────────────────
const IDLE_FALLBACK_MS = 3000;
const READY_DEFERRAL_MS = 5_000;
const SIDE_EFFECT_THROTTLE_MS = 250;

/**
 * Options for creating a Terminal instance
 */
export interface TerminalOptions {
  ptyId?: PtyId;
  projectPath: string;
  command?: string;
  label: string;
  sandboxed?: boolean;
  taskId?: number | null;
  taskPrompt?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  tags?: string[];
  isRunner?: boolean;
  /** Initial summary type (e.g. 'thinking' for reconnected terminals) */
  initialSummaryType?: SummaryType;
}

/**
 * Get terminal color theme (dark theme for terminal containers)
 */
function getTerminalTheme(): Record<string, string> {
  return {
    background: '#171717',
    foreground: '#e4e4e4',
    cursor: '#e4e4e4',
    cursorAccent: '#171717',
    selectionBackground: 'rgba(255, 255, 255, 0.15)',
    black: '#171717',
    red: '#ff6b6b',
    green: '#69db7c',
    yellow: '#ffd43b',
    blue: '#74c0fc',
    magenta: '#da77f2',
    cyan: '#66d9e8',
    white: '#e4e4e4',
    brightBlack: '#5c5c5c',
    brightRed: '#ff8787',
    brightGreen: '#8ce99a',
    brightYellow: '#ffe066',
    brightBlue: '#a5d8ff',
    brightMagenta: '#e599f7',
    brightCyan: '#99e9f2',
    brightWhite: '#ffffff',
  };
}

/**
 * Set up custom key handler for a terminal to let app hotkeys pass through.
 */
function setupTerminalAppHotkeys(terminal: XTerminal): void {
  terminal.attachCustomKeyEventHandler((event) => {
    const hasModifier = isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

    if (hasModifier && !event.altKey) {
      const key = event.key.toLowerCase();

      // Linux: Ctrl+Shift+C/V for terminal copy/paste
      if (!isMac && event.shiftKey && event.type === 'keydown') {
        if (key === 'c') {
          const selection = terminal.getSelection();
          if (selection) navigator.clipboard.writeText(selection);
          return false;
        }
        if (key === 'v') {
          event.preventDefault();
          navigator.clipboard.readText().then(text => {
            if (text) terminal.paste(text);
          });
          return false;
        }
      }

      // Mod+Shift+Arrow for page navigation
      if (event.shiftKey && (key === 'arrowleft' || key === 'arrowright')) {
        return false;
      }

      // App hotkeys that should pass through to hotkeys-js
      const appHotkeys = ['n', 't', 'b', 'i', 'p', 'd', 's', 'w', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      if (appHotkeys.includes(key)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Call fitAddon.fit() while preserving the terminal's scroll position.
 */
export function scrollSafeFit(terminal: XTerminal, fitAddon: FitAddon): void {
  const buf = terminal.buffer.active;
  const atBottom = buf.viewportY >= buf.baseY;
  const savedY = buf.viewportY;

  fitAddon.fit();

  if (!atBottom) {
    const newY = Math.min(savedY, terminal.buffer.active.baseY);
    terminal.scrollToLine(newY);
  }
}

// Track pending resize timeouts per PTY (debounce rapid resize events)
const pendingResizes = new Map<PtyId, ReturnType<typeof setTimeout>>();
const pendingResizeFrames = new Map<PtyId, number>();

/**
 * Debounced resize handler to avoid rapid SIGWINCH signals.
 */
function debouncedResize(ptyId: PtyId, terminal: XTerminal, fitAddon: FitAddon): void {
  const pending = pendingResizes.get(ptyId);
  if (pending) clearTimeout(pending);

  const pendingFrame = pendingResizeFrames.get(ptyId);
  if (pendingFrame) cancelAnimationFrame(pendingFrame);

  pendingResizeFrames.set(ptyId, requestAnimationFrame(() => {
    pendingResizeFrames.delete(ptyId);
    scrollSafeFit(terminal, fitAddon);
  }));

  pendingResizes.set(ptyId, setTimeout(() => {
    pendingResizes.delete(ptyId);
    window.api.pty.resize(ptyId, terminal.cols, terminal.rows);
  }, 50));
}

/**
 * Format a branch name for display (hyphens to spaces)
 */
export function formatBranchNameForDisplay(branch: string): string {
  const agentMatch = branch.match(/^agent-(\d+)$/);
  if (agentMatch) {
    const timestamp = parseInt(agentMatch[1], 10);
    const date = new Date(timestamp);
    return `Untitled ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  const namedMatch = branch.match(/^(.+)-\d{10,}$/);
  if (namedMatch) return namedMatch[1].replace(/-/g, ' ');
  return branch.replace(/-/g, ' ');
}

/** Resolve the display label for a terminal card. */
export function resolveTerminalLabel(
  taskName: string | null | undefined,
  worktreeBranch: string | undefined,
  fallback?: string,
): string {
  if (taskName) return taskName;
  if (worktreeBranch) return formatBranchNameForDisplay(worktreeBranch);
  return fallback || 'Shell';
}

/**
 * Terminal — encapsulates a single terminal session with its xterm instance,
 * PTY connection, DOM card, display signals, and optional child runner.
 */
export class OuijitTerminal {
  // ── Identity ────────────────────────────────────────────────────────
  ptyId: PtyId = '' as PtyId;
  readonly projectPath: string;
  command: string | undefined;
  readonly isRunner: boolean;

  // ── xterm + DOM ─────────────────────────────────────────────────────
  readonly xterm: XTerminal;
  readonly fitAddon: FitAddon;
  readonly container: HTMLElement;

  // ── PTY cleanup ─────────────────────────────────────────────────────
  private cleanupData: (() => void) | null = null;
  cleanupExit: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // ── Signal-based display state (auto-updates DOM) ───────────────────
  readonly label: Signal<string>;
  readonly summary: Signal<string>;
  readonly summaryType: Signal<SummaryType>;
  readonly gitStatus: Signal<CompactGitStatus | null>;
  readonly lastOscTitle: Signal<string>;
  readonly tags: Signal<string[]>;

  // ── Task/worktree metadata ──────────────────────────────────────────
  readonly sandboxed: boolean;
  readonly taskId: number | null;
  readonly taskPrompt?: string;
  worktreePath?: string;
  worktreeBranch?: string;

  // ── Per-terminal diff panel state ───────────────────────────────────
  diffPanelOpen = false;
  diffPanelFiles: ChangedFile[] = [];
  diffPanelSelectedFile: string | null = null;
  diffPanelMode: 'uncommitted' | 'worktree' = 'uncommitted';

  // ── Runner (child Terminal) ─────────────────────────────────────────
  runner: OuijitTerminal | null = null;
  runnerPanelOpen = false;
  runnerFullWidth = true;
  runnerSplitRatio = 0.5;
  runnerCommand: string | null = null;
  runnerStatus: 'running' | 'success' | 'error' | 'idle' = 'idle';
  private runnerResizeCleanup: (() => void) | null = null;

  // ── Data side-effect throttling ─────────────────────────────────────
  private sideEffectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDataChunks: string[] = [];

  // ── Idle timer state ────────────────────────────────────────────────
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readyDeferralTimer: ReturnType<typeof setTimeout> | null = null;
  private hookThinkingCount = 0;

  // ── Lifecycle ───────────────────────────────────────────────────────
  private disposed = false;
  private bound = false;
  private effectCleanups: (() => void)[] = [];

  // ── Close/click callbacks (set by TerminalManager) ──────────────────
  private onCloseHandler: (() => void) | null = null;
  private onClickHandler: (() => void) | null = null;

  // ── Project name callback (for notifications) ──────────────────────
  private getProjectName: (() => string) | null = null;

  constructor(opts: TerminalOptions) {
    this.projectPath = opts.projectPath;
    this.command = opts.command;
    this.isRunner = opts.isRunner ?? false;
    this.sandboxed = opts.sandboxed ?? false;
    this.taskId = opts.taskId ?? null;
    this.taskPrompt = opts.taskPrompt;
    this.worktreePath = opts.worktreePath;
    this.worktreeBranch = opts.worktreeBranch;

    if (opts.taskId != null) {
      this.diffPanelMode = 'worktree';
    }

    // Initialize display signals
    this.label = signal(opts.label);
    this.summary = signal('');
    this.summaryType = signal(opts.initialSummaryType ?? 'ready');
    this.gitStatus = signal<CompactGitStatus | null>(null);
    this.lastOscTitle = signal('');
    this.tags = signal(opts.tags ?? []);

    // Create xterm instance
    this.xterm = new XTerminal({
      theme: getTerminalTheme(),
      fontFamily: 'Iosevka Term Extended, SF Mono, Monaco, Menlo, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: !this.isRunner,
      cursorStyle: 'bar',
      allowTransparency: false,
      scrollback: 2000,
    });

    this.fitAddon = new FitAddon();
    this.xterm.loadAddon(this.fitAddon);
    this.xterm.loadAddon(new WebLinksAddon((_event, uri) => {
      window.api.openExternal(uri);
    }));

    setupTerminalAppHotkeys(this.xterm);

    // Build the DOM card
    if (this.isRunner) {
      this.container = this.buildRunnerDOM();
    } else {
      this.container = this.buildCardDOM(opts.label);
      this.setupLabelEffects();
    }

    // Bind immediately if ptyId was provided
    if (opts.ptyId) {
      this.ptyId = opts.ptyId;
    }
  }

  // ── DOM Construction ────────────────────────────────────────────────

  private buildCardDOM(label: string): HTMLElement {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.index = '0';

    const labelEl = document.createElement('div');
    labelEl.className = 'project-card-label';

    labelEl.innerHTML = `
      <div class="project-card-label-left">
        <div class="project-card-label-top">
          <span class="project-card-status-dot" data-status="ready"></span>
          <kbd class="project-card-shortcut" style="display: none;"></kbd>
          <span class="project-card-label-text">${escapeHtml(label)}</span>
          <button class="project-card-tag-btn" title="Tags"><i data-icon="tag"></i></button>
          <span class="project-card-tags-row"></span>
        </div>
        <div class="project-card-git-branch-row"></div>
      </div>
      <div class="project-card-label-right">
        <div class="project-card-git-stats-wrapper"></div>
        <button class="card-tab card-tab-run" data-action="run" style="display: none;">Run</button>
        <button class="project-card-close" title="Close terminal"><i data-icon="x"></i></button>
      </div>
    `;
    card.appendChild(labelEl);
    convertTitlesIn(labelEl);

    const cardBody = document.createElement('div');
    cardBody.className = 'project-card-body';

    const viewport = document.createElement('div');
    viewport.className = 'terminal-viewport';

    const xtermContainer = document.createElement('div');
    xtermContainer.className = 'terminal-xterm-container';
    viewport.appendChild(xtermContainer);

    cardBody.appendChild(viewport);
    card.appendChild(cardBody);

    // Convert icons in the card
    convertIconsIn(card);

    // Mark sandboxed terminals
    if (this.sandboxed) {
      const dot = card.querySelector('.project-card-status-dot');
      if (dot) dot.classList.add('project-card-status-dot--sandboxed');
    }

    // Wire close button
    const closeBtn = card.querySelector('.project-card-close') as HTMLButtonElement;
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onCloseHandler?.();
      });
    }

    // Wire card click (bring to front)
    card.addEventListener('click', () => {
      this.onClickHandler?.();
    });

    return card;
  }

  private buildRunnerDOM(): HTMLElement {
    // Runner terminals don't get a full card — just a container for the xterm
    const container = document.createElement('div');
    container.className = 'terminal-runner-wrapper';
    const xtermContainer = document.createElement('div');
    xtermContainer.className = 'runner-xterm-container';
    container.appendChild(xtermContainer);
    return container;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Set the close handler (called by TerminalManager) */
  setCloseHandler(handler: () => void): void {
    this.onCloseHandler = handler;
  }

  /** Set the click handler (called by TerminalManager) */
  setClickHandler(handler: () => void): void {
    this.onClickHandler = handler;
  }

  /** Set project name getter for notifications */
  setProjectNameGetter(getter: () => string): void {
    this.getProjectName = getter;
  }

  /** Get the git path (worktree path if task-based, otherwise project path) */
  getGitPath(): string {
    return this.worktreePath || this.projectPath;
  }

  /**
   * Open the xterm in its container and set up drag/drop.
   * Call after the container is in the DOM.
   */
  openTerminal(): void {
    const xtermContainer = this.container.querySelector(
      this.isRunner ? '.runner-xterm-container' : '.terminal-xterm-container'
    ) as HTMLElement;
    if (!xtermContainer) return;

    this.xterm.open(xtermContainer);
    this.wireDragDrop(xtermContainer);
  }

  /**
   * Fit the terminal and optionally sync PTY dimensions.
   */
  fit(): void {
    scrollSafeFit(this.xterm, this.fitAddon);
    if (this.ptyId) {
      window.api.pty.resize(this.ptyId, this.xterm.cols, this.xterm.rows);
    }
  }

  /**
   * Bind to a PTY — wire data, exit, input, and resize handlers.
   * For sandbox terminals, this is called after VM boot completes.
   */
  bind(ptyId: PtyId, opts?: { onData?: (data: string) => void; onExit?: (exitCode: number) => void; skipSideEffects?: boolean }): void {
    if (this.disposed) return;
    this.ptyId = ptyId;
    this.bound = true;

    this.wireDataHandler(opts?.skipSideEffects, opts?.onData);
    this.wireExitHandler(opts?.onExit);
    this.wireInputForwarding();
    this.wireResizeObserver();
  }

  /**
   * Replay buffered output from a reconnected PTY session.
   */
  replayBuffer(bufferedOutput: string | undefined, lastCols?: number, isAltScreen?: boolean): void {
    if (!bufferedOutput) return;

    // Strip zsh PROMPT_EOL_MARK artifact
    let buffer = bufferedOutput.replace(/^(?:\x1b\[[0-9;]*m)*[%#](?:\x1b\[[0-9;]*m)* +\r \r/, '');

    const currentCols = this.xterm.cols;
    const currentRows = this.xterm.rows;

    // Replay at original terminal width for correct wrapping
    if (lastCols && lastCols !== currentCols) {
      this.xterm.resize(lastCols, currentRows);
    }

    // Enter alt screen if needed
    if (isAltScreen) {
      this.xterm.write('\x1b[?1049h');
    }

    this.xterm.write(buffer);

    // Restore current dimensions
    if (lastCols && lastCols !== currentCols) {
      this.xterm.resize(currentCols, currentRows);
    }

    // Extract last OSC title from buffer
    const oscMatches = buffer.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
    let lastTitle = '';
    for (const match of oscMatches) {
      lastTitle = match[1];
    }
    if (lastTitle) {
      this.lastOscTitle.value = lastTitle;
    }
  }

  /**
   * Detach from the DOM — disconnect resize observer but keep everything alive.
   * Used during view transitions and session preservation.
   */
  detach(): void {
    this.resizeObserver?.disconnect();
    this.clearDataThrottle();
  }

  /**
   * Re-attach after detach — reconnect resize observer.
   * Used when restoring a session.
   */
  reattach(): void {
    if (!this.ptyId || this.disposed) return;

    const xtermContainer = this.container.querySelector(
      this.isRunner ? '.runner-xterm-container' : '.terminal-xterm-container'
    ) as HTMLElement;
    if (!xtermContainer) return;

    // Recreate resize observer
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      debouncedResize(this.ptyId, this.xterm, this.fitAddon);
    });
    this.resizeObserver.observe(xtermContainer);

    // Reattach runner if it has one
    if (this.runner?.ptyId) {
      const runnerContainer = this.container.querySelector('.runner-xterm-container') as HTMLElement;
      if (runnerContainer && this.runner.resizeObserver) {
        this.runner.resizeObserver.disconnect();
        this.runner.resizeObserver = new ResizeObserver(() => {
          if (this.runner?.ptyId) {
            debouncedResize(this.runner.ptyId, this.runner.xterm, this.runner.fitAddon);
          }
        });
        this.runner.resizeObserver.observe(runnerContainer);
      }
    }
  }

  /**
   * Dispose — full lifecycle cleanup. Kills PTY, removes listeners,
   * disposes xterm, removes DOM. Handles runner cleanup.
   * Idempotent (safe to call multiple times).
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Kill runner first
    this.killRunner();

    // Kill main PTY
    if (this.ptyId) {
      window.api.pty.kill(this.ptyId);
      this.clearIdleTimer();
      this.clearDataThrottle();
    }

    // Remove IPC listeners
    this.cleanupData?.();
    this.cleanupExit?.();

    // Disconnect observers
    this.resizeObserver?.disconnect();

    // Dispose xterm
    this.xterm.dispose();

    // Clean up signal effects
    for (const cleanup of this.effectCleanups) cleanup();
    this.effectCleanups.length = 0;

    // Remove DOM
    this.container.remove();
  }

  // ── Runner management ───────────────────────────────────────────────

  /**
   * Set a child terminal as the runner.
   */
  setRunner(runner: OuijitTerminal): void {
    this.killRunner();
    this.runner = runner;
  }

  /**
   * Kill and dispose the runner.
   */
  killRunner(): void {
    if (!this.runner) return;

    this.runnerPanelOpen = false;
    const runBtn = this.container.querySelector('.card-tab-run');
    if (runBtn) runBtn.classList.remove('card-tab--active');

    this.runner.dispose();
    this.runner = null;

    // Clean up runner resize handle drag listeners
    if (this.runnerResizeCleanup) {
      this.runnerResizeCleanup();
      this.runnerResizeCleanup = null;
    }

    // Remove runner panel DOM
    const handle = this.container.querySelector('.runner-resize-handle');
    if (handle) handle.remove();
    const panel = this.container.querySelector('.runner-panel');
    if (panel) panel.remove();

    // Remove runner CSS classes
    const cardBody = this.container.querySelector('.project-card-body');
    if (cardBody) cardBody.classList.remove('runner-split', 'runner-full');

    // Reset runner state
    this.runnerCommand = null;
    this.runnerStatus = 'idle';
    this.runnerFullWidth = true;

    this.updateRunnerPill();
  }

  /**
   * Set runner resize cleanup function (from drag handle setup)
   */
  setRunnerResizeCleanup(cleanup: () => void): void {
    this.runnerResizeCleanup = cleanup;
  }

  /**
   * Update the runner button appearance based on runner state
   */
  updateRunnerPill(): void {
    const btn = this.container.querySelector('.card-tab-run') as HTMLElement;
    if (!btn) return;

    btn.classList.remove('card-tab-run--running', 'card-tab-run--success', 'card-tab-run--error');

    if (this.runner?.ptyId) {
      btn.classList.toggle('card-tab--active', this.runnerPanelOpen);
      switch (this.runnerStatus) {
        case 'running':
          btn.textContent = 'Running';
          btn.classList.add('card-tab-run--running');
          break;
        case 'success':
          btn.textContent = 'Done';
          btn.classList.add('card-tab-run--success');
          break;
        case 'error':
          btn.textContent = 'Failed';
          btn.classList.add('card-tab-run--error');
          break;
        default:
          btn.textContent = 'Run';
          break;
      }
    } else {
      btn.textContent = 'Run';
      btn.classList.remove('card-tab--active');
    }
  }

  // ── Hook status handling ────────────────────────────────────────────

  /** Handle a hook status event for this terminal */
  handleHookStatus(status: 'thinking' | 'ready'): void {
    if (status === 'thinking') {
      this.clearReadyDeferral();
      // Clear any post-deferral idle timer
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }

      if (this.summaryType.value !== 'thinking') {
        this.hookThinkingCount = 0;
        this.summaryType.value = 'thinking';
      }

      this.hookThinkingCount++;
      this.resetIdleTimer();
    } else {
      // Stop / Notification → ready
      if (this.hookThinkingCount > 1 && this.summaryType.value === 'thinking') {
        // Tools were used — defer green transition
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        this.clearReadyDeferral();
        this.readyDeferralTimer = setTimeout(() => {
          this.readyDeferralTimer = null;
          if (this.summaryType.value !== 'thinking') return;
          // Arm idle fallback
          if (this.idleTimer) clearTimeout(this.idleTimer);
          this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.summaryType.value === 'thinking') {
              this.summaryType.value = 'ready';
              const projectName = this.getProjectName?.() ?? 'Ouijit';
              notifyReady(projectName, readyBody(this.label.value, this.lastOscTitle.value));
            }
            this.hookThinkingCount = 0;
          }, IDLE_FALLBACK_MS);
        }, READY_DEFERRAL_MS);
        return;
      }

      // Simple case: go green
      if (this.summaryType.value !== 'ready') {
        this.summaryType.value = 'ready';
        const projectName = this.getProjectName?.() ?? 'Ouijit';
        notifyReady(projectName, readyBody(this.label.value, this.lastOscTitle.value));
      }
      this.clearIdleTimer();
    }
  }

  // ── Internal: PTY wiring ────────────────────────────────────────────

  private wireDataHandler(skipSideEffects?: boolean, onData?: (data: string) => void): void {
    this.cleanupData = window.api.pty.onData(this.ptyId, (data) => {
      this.xterm.write(data);
      onData?.(data);
      if (!skipSideEffects) {
        this.throttledDataSideEffects(data);
      }
    });
  }

  private wireExitHandler(onExit?: (exitCode: number) => void): void {
    this.cleanupExit = window.api.pty.onExit(this.ptyId, (exitCode) => {
      this.xterm.writeln('');
      const exitColor = exitCode === 0 ? '32' : '31';
      this.xterm.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);

      this.summary.value = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
      this.summaryType.value = 'ready';

      onExit?.(exitCode);
    });
  }

  private wireInputForwarding(): void {
    this.xterm.onData((data) => {
      if (this.ptyId) {
        window.api.pty.write(this.ptyId, data);
      }
    });
  }

  private wireResizeObserver(): void {
    const xtermContainer = this.container.querySelector(
      this.isRunner ? '.runner-xterm-container' : '.terminal-xterm-container'
    ) as HTMLElement;
    if (!xtermContainer) return;

    this.resizeObserver = new ResizeObserver(() => {
      debouncedResize(this.ptyId, this.xterm, this.fitAddon);
    });
    this.resizeObserver.observe(xtermContainer);
  }

  private wireDragDrop(xtermContainer: HTMLElement): void {
    const screen = xtermContainer.querySelector('.xterm-screen');
    const target = screen || xtermContainer;

    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if ((e as DragEvent).dataTransfer) {
        (e as DragEvent).dataTransfer!.dropEffect = 'copy';
      }
    });

    target.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dt = (e as DragEvent).dataTransfer;
      if (dt?.files.length) {
        const paths = Array.from(dt.files)
          .map(f => window.api.getPathForFile(f))
          .filter((p): p is string => !!p)
          .map(p => p.includes(' ') ? `"${p}"` : p)
          .join(' ');
        if (paths) this.xterm.paste(paths);
      }
    });
  }

  // ── Data side effects (throttled) ───────────────────────────────────

  private throttledDataSideEffects(data: string): void {
    this.pendingDataChunks.push(data);

    if (this.sideEffectTimer) return; // Already scheduled

    // Fire immediately (leading edge)
    this.fireDataSideEffects();

    // Schedule trailing edge
    this.sideEffectTimer = setTimeout(() => {
      this.sideEffectTimer = null;
      if (this.pendingDataChunks.length > 0) {
        this.fireDataSideEffects();
      }
    }, SIDE_EFFECT_THROTTLE_MS);
  }

  private fireDataSideEffects(): void {
    this.resetIdleTimer();

    const batch = this.pendingDataChunks.join('');
    this.pendingDataChunks.length = 0;

    // OSC title extraction
    const oscMatches = batch.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
    for (const match of oscMatches) {
      const newTitle = match[1];
      if (newTitle !== this.lastOscTitle.value) {
        this.lastOscTitle.value = newTitle;
      }
    }

    // Schedule git status refresh (label auto-updates via signal effect)
    scheduleTerminalGitStatusRefresh(this);
  }

  clearDataThrottle(): void {
    if (this.sideEffectTimer) {
      clearTimeout(this.sideEffectTimer);
      this.sideEffectTimer = null;
    }
    this.pendingDataChunks.length = 0;
  }

  // ── Idle timer ──────────────────────────────────────────────────────

  private resetIdleTimer(): void {
    if (this.summaryType.value !== 'thinking') return;

    // If tools were used and no timer is running, skip (trust Stop/Notification hooks)
    if (this.hookThinkingCount > 1 && !this.idleTimer) return;

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.summaryType.value === 'thinking') {
        this.summaryType.value = 'ready';
      }
      this.hookThinkingCount = 0;
    }, IDLE_FALLBACK_MS);
  }

  clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.clearReadyDeferral();
    this.hookThinkingCount = 0;
  }

  private clearReadyDeferral(): void {
    if (this.readyDeferralTimer) {
      clearTimeout(this.readyDeferralTimer);
      this.readyDeferralTimer = null;
    }
  }

  // ── Signal-based label auto-updates ─────────────────────────────────

  private setupLabelEffects(): void {
    this.effectCleanups.push(
      effect(() => {
        // Read all display signals to establish dependencies
        const _summary = this.summary.value;
        const _summaryType = this.summaryType.value;
        const _gitStatus = this.gitStatus.value;
        const _lastOscTitle = this.lastOscTitle.value;
        const _tags = this.tags.value;
        const _label = this.label.value;
        this.updateLabel();
      })
    );
  }

  /**
   * Update the terminal card DOM to reflect current display signal values.
   * Auto-called by signal effects — no need to call manually.
   */
  updateLabel(): void {
    const labelEl = this.container.querySelector('.project-card-label');
    if (!labelEl) return;

    // Status dot
    let dot = labelEl.querySelector('.project-card-status-dot') as HTMLElement;
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'project-card-status-dot';
      if (this.sandboxed) dot.classList.add('project-card-status-dot--sandboxed');
      labelEl.insertBefore(dot, labelEl.firstChild);
    }
    dot.setAttribute('data-status', this.summaryType.value);

    // Label text
    const labelText = labelEl.querySelector('.project-card-label-text');
    if (labelText) {
      let display = this.label.value;
      if (this.summary.value) {
        display += ` — ${this.summary.value}`;
      }
      labelText.textContent = display;
    }

    // OSC title pill
    const labelTop = labelEl.querySelector('.project-card-label-top');
    if (labelTop) {
      let oscPill = labelTop.querySelector('.project-card-osc-title') as HTMLElement;
      if (this.lastOscTitle.value) {
        if (!oscPill) {
          oscPill = document.createElement('span');
          oscPill.className = 'project-card-osc-title';
          const tagsAnchor = labelTop.querySelector('.project-card-tags-row');
          if (tagsAnchor) {
            labelTop.insertBefore(oscPill, tagsAnchor);
          } else {
            labelTop.appendChild(oscPill);
          }
        }
        oscPill.textContent = this.lastOscTitle.value;
        addTooltip(oscPill, { text: this.lastOscTitle.value });
      } else if (oscPill) {
        oscPill.remove();
      }
    }

    // Tag pills
    const tagsRow = labelEl.querySelector('.project-card-tags-row') as HTMLElement;
    if (tagsRow && !tagsRow.querySelector('.tag-input-container')) {
      const tagsHtml = this.tags.value.map(t => `<span class="project-card-tag-pill">${escapeHtml(t)}</span>`).join('');
      if (tagsRow.dataset.lastHtml !== tagsHtml) {
        tagsRow.dataset.lastHtml = tagsHtml;
        tagsRow.innerHTML = tagsHtml;
      }
    }
    this.container.classList.toggle('project-card--has-tags', this.tags.value.length > 0);

    // Git branch row
    const branchRow = labelEl.querySelector('.project-card-git-branch-row') as HTMLElement;
    if (branchRow) {
      const branchHtml = buildCardGitBranchHtml(this.gitStatus.value);
      if (branchRow.dataset.lastHtml !== branchHtml) {
        branchRow.dataset.lastHtml = branchHtml;
        branchRow.innerHTML = branchHtml;
        convertTitlesIn(branchRow);
      }
    }

    // Git stats
    const statsWrapper = labelEl.querySelector('.project-card-git-stats-wrapper') as HTMLElement;
    if (statsWrapper) {
      const isWorktree = this.taskId != null && !!this.worktreeBranch;
      const statsHtml = buildCardGitStatsHtml(this.gitStatus.value, isWorktree);
      if (statsWrapper.dataset.lastHtml !== statsHtml) {
        statsWrapper.dataset.lastHtml = statsHtml;
        statsWrapper.innerHTML = statsHtml;
        convertTitlesIn(statsWrapper);

        const statsEl = statsWrapper.querySelector('.project-card-git-stats--clickable') as HTMLElement;
        if (statsEl) {
          if (this.diffPanelOpen) statsEl.classList.add('card-tab--active');
          const isCompareBtn = statsEl.classList.contains('project-card-git-stats--compare');
          statsEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isCompareBtn) {
              toggleTerminalWorktreeDiffPanel(this);
            } else {
              toggleTerminalDiffPanel(this);
            }
          });
        }
      }
    }

    // Sync kanban status dots
    projectRegistry.syncKanbanStatusDots?.();
  }

  // ── Git status refresh ──────────────────────────────────────────────

  /** Kick off an initial git status fetch and update signals */
  async refreshGitStatus(): Promise<void> {
    await refreshTerminalGitStatus(this);
  }

  /** Load tags from the database for task terminals */
  async loadTags(): Promise<void> {
    if (this.taskId == null) return;
    try {
      const tags = await window.api.tags.getForTask(this.projectPath, this.taskId);
      this.tags.value = tags.map(t => t.name);
    } catch { /* DB not ready or task gone */ }
  }

  /**
   * Force a SIGWINCH to make the shell redraw at correct dimensions.
   */
  forceSigwinch(): void {
    if (!this.ptyId) return;
    window.api.pty.resize(this.ptyId, this.xterm.cols + 1, this.xterm.rows);
    window.api.pty.resize(this.ptyId, this.xterm.cols, this.xterm.rows);
  }
}
