/**
 * OuijitTerminal (React) — encapsulates xterm instance, PTY lifecycle,
 * and display state push to Zustand terminalStore.
 *
 * React owns the card chrome (header, tags, git stats, runner panel).
 * This class owns only the xterm viewport and imperative PTY wiring.
 */

import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { PtyId, PtySpawnOptions, GitFileStatus } from '../../types';
import { notifyReady, readyBody } from '../../utils/notifications';
import { useTerminalStore } from '../../stores/terminalStore';

// ── Idle fallback timer constants ────────────────────────────────────
const IDLE_FALLBACK_MS = 3000;
const READY_DEFERRAL_MS = 5_000;
const SIDE_EFFECT_THROTTLE_MS = 250;

export type SummaryType = 'thinking' | 'ready';

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
  initialSummaryType?: SummaryType;
}

function getTerminalTheme(): Record<string, string> {
  return {
    background: '#171717',
    foreground: '#e4e4e4',
    cursor: '#e4e4e4',
    cursorAccent: '#171717',
    selectionBackground: 'rgba(255, 255, 255, 0.15)',
    scrollbarSliderBackground: 'rgba(255, 255, 255, 0.15)',
    scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.3)',
    scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.4)',
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

// Platform detection
const isMac = navigator.platform.toLowerCase().includes('mac');

function setupTerminalAppHotkeys(terminal: XTerminal): void {
  terminal.attachCustomKeyEventHandler((event) => {
    const hasModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

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
          navigator.clipboard.readText().then((text) => {
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

/** Call fitAddon.fit() while preserving the terminal's scroll position. */
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

// Track pending resize timeouts per PTY
const pendingResizes = new Map<PtyId, ReturnType<typeof setTimeout>>();
const pendingResizeFrames = new Map<PtyId, number>();

function debouncedResize(ptyId: PtyId, terminal: XTerminal, fitAddon: FitAddon): void {
  const pending = pendingResizes.get(ptyId);
  if (pending) clearTimeout(pending);

  const pendingFrame = pendingResizeFrames.get(ptyId);
  if (pendingFrame) cancelAnimationFrame(pendingFrame);

  pendingResizeFrames.set(
    ptyId,
    requestAnimationFrame(() => {
      pendingResizeFrames.delete(ptyId);
      scrollSafeFit(terminal, fitAddon);
    }),
  );

  pendingResizes.set(
    ptyId,
    setTimeout(() => {
      pendingResizes.delete(ptyId);
      const instance = terminalInstances.get(ptyId);
      if (instance) {
        instance.syncPtySize();
      }
    }, 150),
  );
}

/** Format a branch name for display (hyphens to spaces) */
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

// ── Terminal instance registry (outside React state) ─────────────────

/** Global registry of OuijitTerminal instances by ptyId */
export const terminalInstances = new Map<string, OuijitTerminal>();

// ── Git status refresh scheduling ────────────────────────────────────

const pendingTerminalGitRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
let lastDataDrivenRefresh = 0;
const GIT_STATUS_IDLE_DELAY = 3000;

export function clearAllPendingGitRefreshes(): void {
  for (const timer of pendingTerminalGitRefreshes.values()) {
    clearTimeout(timer);
  }
  pendingTerminalGitRefreshes.clear();
}

export function resetDataDrivenRefreshTimestamp(): void {
  lastDataDrivenRefresh = 0;
}

export function shouldSkipPeriodicRefresh(): boolean {
  return Date.now() - lastDataDrivenRefresh < 10000;
}

function scheduleTerminalGitStatusRefresh(term: OuijitTerminal): void {
  const key = term.ptyId;
  const existing = pendingTerminalGitRefreshes.get(key);
  if (existing) clearTimeout(existing);

  pendingTerminalGitRefreshes.set(
    key,
    setTimeout(async () => {
      await refreshTerminalGitStatus(term);
      lastDataDrivenRefresh = Date.now();
      pendingTerminalGitRefreshes.delete(key);
    }, GIT_STATUS_IDLE_DELAY),
  );
}

export async function refreshTerminalGitStatus(term: OuijitTerminal): Promise<void> {
  const gitPath = term.worktreePath || term.projectPath;
  const fileStatus = await window.api.getGitFileStatus(gitPath);
  term.gitFileStatus = fileStatus;
  term.pushDisplayState({ gitFileStatus: fileStatus });
}

export async function refreshAllTerminalGitStatus(projectPath: string): Promise<void> {
  const store = useTerminalStore.getState();
  const ptyIds = store.terminalsByProject[projectPath] ?? [];
  if (ptyIds.length === 0) return;

  const pathToTerminals = new Map<string, OuijitTerminal[]>();
  for (const ptyId of ptyIds) {
    const term = terminalInstances.get(ptyId);
    if (!term) continue;
    const gitPath = term.worktreePath || term.projectPath;
    const group = pathToTerminals.get(gitPath);
    if (group) {
      group.push(term);
    } else {
      pathToTerminals.set(gitPath, [term]);
    }
  }

  await Promise.all(
    Array.from(pathToTerminals.entries()).map(async ([gitPath, terms]) => {
      const fileStatus = await window.api.getGitFileStatus(gitPath);
      for (const t of terms) {
        t.gitFileStatus = fileStatus;
        t.pushDisplayState({ gitFileStatus: fileStatus });
      }
    }),
  );
}

// ── OuijitTerminal class ─────────────────────────────────────────────

export class OuijitTerminal {
  // ── Identity ────────────────────────────────────────────────────────
  ptyId: PtyId = '' as PtyId;
  readonly projectPath: string;
  command: string | undefined;
  readonly isRunner: boolean;

  // ── xterm + viewport ───────────────────────────────────────────────
  readonly xterm: XTerminal;
  readonly fitAddon: FitAddon;
  private viewportElement: HTMLDivElement;

  // ── PTY cleanup ─────────────────────────────────────────────────────
  private cleanupData: (() => void) | null = null;
  cleanupExit: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // ── Display state (plain values, pushed to Zustand) ────────────────
  label: string;
  summary = '';
  summaryType: SummaryType;
  gitFileStatus: GitFileStatus | null = null;
  lastOscTitle = '';
  tags: string[];

  // ── Task/worktree metadata ──────────────────────────────────────────
  readonly sandboxed: boolean;
  readonly taskId: number | null;
  readonly taskPrompt?: string;
  worktreePath?: string;
  worktreeBranch?: string;

  // ── Per-terminal diff panel state ───────────────────────────────────
  diffPanelOpen = false;
  diffPanelMode: 'uncommitted' | 'worktree' = 'uncommitted';

  // ── Runner (child OuijitTerminal) ──────────────────────────────────
  runner: OuijitTerminal | null = null;
  runnerPanelOpen = false;
  runnerFullWidth = true;
  runnerSplitRatio = 0.5;
  runnerCommand: string | null = null;
  runnerScript: { name: string; command: string } | null = null;
  runnerStatus: 'running' | 'success' | 'error' | 'idle' = 'idle';
  _runnerSpawning = false;

  // ── Data side-effect throttling ─────────────────────────────────────
  private sideEffectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDataChunks: string[] = [];

  // ── Idle timer state ────────────────────────────────────────────────
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readyDeferralTimer: ReturnType<typeof setTimeout> | null = null;
  private hookThinkingCount = 0;

  // ── Scroll preservation ─────────────────────────────────────────────
  private _scrollRestoreY: number | null = null;
  private _scrollRestoreRaf: number | null = null;

  // ── Lifecycle ───────────────────────────────────────────────────────
  private disposed = false;
  private bound = false;
  private lastSentCols = 0;
  private lastSentRows = 0;
  private resizeSuppressed = false;

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

    // Initialize display state
    this.label = opts.label;
    this.summaryType = opts.initialSummaryType ?? 'ready';
    this.tags = opts.tags ?? [];

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
    this.xterm.loadAddon(
      new WebLinksAddon((_event, uri) => {
        window.api.openExternal(uri);
      }),
    );

    setupTerminalAppHotkeys(this.xterm);

    // Create viewport element (minimal — React owns card chrome)
    this.viewportElement = document.createElement('div');
    this.viewportElement.className = 'w-full h-full';

    // Bind immediately if ptyId was provided
    if (opts.ptyId) {
      this.ptyId = opts.ptyId;
    }
  }

  // ── Viewport access for React ──────────────────────────────────────

  /** Get the DOM element containing the xterm viewport. React components reparent this. */
  getViewportElement(): HTMLDivElement {
    return this.viewportElement;
  }

  // ── Display state push ─────────────────────────────────────────────

  /** Push a partial display state update to the Zustand store. */
  pushDisplayState(patch: Record<string, unknown>): void {
    if (!this.ptyId) return;
    useTerminalStore.getState().updateDisplay(this.ptyId, patch);
  }

  /** Set project name getter for notifications */
  setProjectNameGetter(getter: () => string): void {
    this.getProjectName = getter;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Open the xterm in its viewport element and set up drag/drop. */
  openTerminal(): void {
    this.xterm.open(this.viewportElement);
    this.wireDragDrop(this.viewportElement);
  }

  /** Fit the terminal to its container. Does NOT sync PTY dimensions —
   *  that's handled by debouncedResize (via ResizeObserver) which coalesces
   *  rapid layout changes and avoids spurious SIGWINCH to the shell. */
  fit(): void {
    scrollSafeFit(this.xterm, this.fitAddon);
  }

  /** Suppress PTY resizes during reconnection until layout settles. */
  suppressResizeDuring(ms: number): void {
    this.resizeSuppressed = true;
    setTimeout(() => {
      this.resizeSuppressed = false;
      // Sync once after layout has settled
      this.syncPtySize();
    }, ms);
  }

  /** Send a PTY resize only when dimensions have actually changed. */
  syncPtySize(): void {
    if (!this.ptyId || this.resizeSuppressed) return;
    const { cols, rows } = this.xterm;
    if (cols === this.lastSentCols && rows === this.lastSentRows) return;
    this.lastSentCols = cols;
    this.lastSentRows = rows;
    window.api.pty.resize(this.ptyId, cols, rows);
  }

  /** Bind to a PTY — wire data, exit, input, and resize handlers. */
  bind(
    ptyId: PtyId,
    opts?: { onData?: (data: string) => void; onExit?: (exitCode: number) => void; skipSideEffects?: boolean },
  ): void {
    if (this.disposed) return;
    this.ptyId = ptyId;
    this.bound = true;

    this.wireDataHandler(opts?.skipSideEffects, opts?.onData);
    this.wireExitHandler(opts?.onExit);
    this.wireInputForwarding();
    this.wireResizeObserver();
  }

  /** Spawn a PTY, showing sandbox progress if sandboxed. */
  async spawnPty(options: PtySpawnOptions): Promise<PtyId | null> {
    let cleanupProgress: (() => void) | null = null;
    if (options.sandboxed) {
      const spinner = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
      let frame = 0;
      let activeLabel = 'Connecting to sandbox…';
      let activeId = '_init';

      // Truncate label to fit in one terminal row (leave room for spinner + padding)
      const truncate = (label: string) => {
        const maxLen = this.xterm.cols - 4; // "⠋ " prefix + safety margin
        return label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label;
      };

      // Write initial spinner line
      this.xterm.write(`\x1b[90m${spinner[0]} ${activeLabel}\x1b[0m`);

      // Spinner animation: overwrite in place, then clear trailing chars (no full line clear to avoid flicker)
      const interval = setInterval(() => {
        frame = (frame + 1) % spinner.length;
        this.xterm.write(`\r\x1b[90m${spinner[frame]} ${truncate(activeLabel)}\x1b[0m\x1b[K`);
      }, 80);

      const unlistenProgress = window.api.lima.onSpawnProgress((step) => {
        if (step.id === activeId) {
          activeLabel = step.label;
          if (step.status === 'done') {
            this.xterm.write(`\r\x1b[90m✓ ${truncate(step.label)}\x1b[0m\x1b[K\r\n`);
            activeLabel = '';
            activeId = '';
          }
        } else {
          if (activeId) {
            this.xterm.write(`\r\x1b[90m✓ ${truncate(activeLabel)}\x1b[0m\x1b[K\r\n`);
          }
          activeId = step.id;
          activeLabel = step.label;
          if (step.status === 'done') {
            this.xterm.write(`\x1b[90m✓ ${truncate(step.label)}\x1b[0m\x1b[K\r\n`);
            activeLabel = '';
            activeId = '';
          }
        }
      });

      cleanupProgress = () => {
        clearInterval(interval);
        unlistenProgress();
        // Clear any leftover spinner line
        if (activeId) {
          this.xterm.write('\r\x1b[2K');
        }
      };
    }

    const result = await window.api.pty.spawn(options);
    cleanupProgress?.();

    if (!result.success || !result.ptyId) {
      this.xterm.writeln(`\x1b[31mFailed to start terminal: ${result.error || 'Unknown error'}\x1b[0m`);
      this.xterm.writeln(`\x1b[90mThis card will close in 10 seconds.\x1b[0m`);
      return null;
    }

    this.bind(result.ptyId);
    // Suppress resize while layout settles to avoid SIGWINCH → zsh % artifacts
    this.suppressResizeDuring(500);
    return result.ptyId;
  }

  /** Replay buffered output from a reconnected PTY session. */
  replayBuffer(bufferedOutput: string | undefined, lastCols?: number, isAltScreen?: boolean): void {
    if (!bufferedOutput) return;

    // Strip zsh PROMPT_EOL_MARK artifacts: '%' or '#' padded with spaces, followed by CR-space-CR
    const buffer = bufferedOutput.replace(/(?:\x1b\[[0-9;]*m)*[%#](?:\x1b\[[0-9;]*m)* +\r \r/g, '');

    const currentCols = this.xterm.cols;
    const currentRows = this.xterm.rows;

    if (lastCols && lastCols !== currentCols) {
      this.xterm.resize(lastCols, currentRows);
    }

    if (isAltScreen) {
      this.xterm.write('\x1b[?1049h');
    }

    this.xterm.write(buffer);

    if (lastCols && lastCols !== currentCols) {
      this.xterm.resize(currentCols, currentRows);
    }

    const oscMatches = buffer.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
    let lastTitle = '';
    for (const match of oscMatches) {
      lastTitle = match[1];
    }
    if (lastTitle) {
      this.lastOscTitle = lastTitle;
      this.pushDisplayState({ lastOscTitle: lastTitle });
    }
  }

  /** Detach — disconnect resize observer but keep everything alive. */
  detach(): void {
    this.resizeObserver?.disconnect();
    this.clearDataThrottle();
  }

  /** Re-attach after detach — reconnect resize observer. */
  reattach(): void {
    if (!this.ptyId || this.disposed) return;

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      debouncedResize(this.ptyId, this.xterm, this.fitAddon);
    });
    this.resizeObserver.observe(this.viewportElement);

    // Reattach runner's resize observer if it has one
    if (this.runner?.ptyId) {
      const runnerViewport = this.runner.getViewportElement();
      if (this.runner.resizeObserver) {
        this.runner.resizeObserver.disconnect();
      }
      this.runner.resizeObserver = new ResizeObserver(() => {
        if (this.runner?.ptyId) {
          debouncedResize(this.runner.ptyId, this.runner.xterm, this.runner.fitAddon);
        }
      });
      this.runner.resizeObserver.observe(runnerViewport);
    }
  }

  /** Dispose — full lifecycle cleanup. Kills PTY, removes listeners, disposes xterm. */
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

    // Cancel pending scroll restore
    if (this._scrollRestoreRaf !== null) {
      cancelAnimationFrame(this._scrollRestoreRaf);
      this._scrollRestoreRaf = null;
    }

    // Disconnect observers
    this.resizeObserver?.disconnect();

    // Dispose xterm
    this.xterm.dispose();

    // Remove from instance registry
    if (this.ptyId) {
      terminalInstances.delete(this.ptyId);
    }

    // Remove viewport element
    this.viewportElement.remove();
  }

  // ── Runner management ───────────────────────────────────────────────

  setRunner(runner: OuijitTerminal): void {
    this.killRunner();
    this.runner = runner;
  }

  killRunner(): void {
    if (!this.runner) return;

    this.runnerPanelOpen = false;
    this.runner.dispose();
    this.runner = null;

    this.runnerCommand = null;
    this.runnerScript = null;
    this.runnerStatus = 'idle';
    this.runnerFullWidth = true;

    this.pushDisplayState({
      runnerPanelOpen: false,
      runnerStatus: 'idle',
      runnerScriptName: null,
    });
  }

  // ── Hook status handling ────────────────────────────────────────────

  handleHookStatus(status: 'thinking' | 'ready'): void {
    if (status === 'thinking') {
      this.clearReadyDeferral();
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }

      if (this.summaryType !== 'thinking') {
        this.hookThinkingCount = 0;
        this.summaryType = 'thinking';
        this.pushDisplayState({ summaryType: 'thinking' });
      }

      this.hookThinkingCount++;
      this.resetIdleTimer();
    } else {
      if (this.hookThinkingCount > 1 && this.summaryType === 'thinking') {
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        this.clearReadyDeferral();
        this.readyDeferralTimer = setTimeout(() => {
          this.readyDeferralTimer = null;
          if (this.summaryType !== 'thinking') return;
          if (this.idleTimer) clearTimeout(this.idleTimer);
          this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.summaryType === 'thinking') {
              this.summaryType = 'ready';
              this.pushDisplayState({ summaryType: 'ready' });
              const projectName = this.getProjectName?.() ?? 'Ouijit';
              notifyReady(projectName, readyBody(this.label, this.lastOscTitle));
            }
            this.hookThinkingCount = 0;
          }, IDLE_FALLBACK_MS);
        }, READY_DEFERRAL_MS);
        return;
      }

      if (this.summaryType !== 'ready') {
        this.summaryType = 'ready';
        this.pushDisplayState({ summaryType: 'ready' });
        const projectName = this.getProjectName?.() ?? 'Ouijit';
        notifyReady(projectName, readyBody(this.label, this.lastOscTitle));
      }
      this.clearIdleTimer();
    }
  }

  // ── Git status ─────────────────────────────────────────────────────

  async refreshGitStatus(): Promise<void> {
    await refreshTerminalGitStatus(this);
  }

  async loadTags(): Promise<void> {
    if (this.taskId == null) return;
    try {
      const tags = await window.api.tags.getForTask(this.projectPath, this.taskId);
      this.tags = tags.map((t) => t.name);
      this.pushDisplayState({ tags: this.tags });
    } catch {
      /* DB not ready or task gone */
    }
  }

  // ── Internal: PTY wiring ────────────────────────────────────────────

  private wireDataHandler(skipSideEffects?: boolean, onData?: (data: string) => void): void {
    this.cleanupData = window.api.pty.onData(this.ptyId, (data) => {
      const buf = this.xterm.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;

      // Capture scroll position on the first write of a batch (while value is still trustworthy)
      if (!atBottom && this._scrollRestoreY === null) {
        this._scrollRestoreY = buf.viewportY;
      } else if (atBottom) {
        this._scrollRestoreY = null;
      }

      this.xterm.write(data);

      // Coalesce into a single rAF so the restore runs after xterm's render pass
      if (this._scrollRestoreY !== null && this._scrollRestoreRaf === null) {
        const targetY = this._scrollRestoreY;
        this._scrollRestoreRaf = requestAnimationFrame(() => {
          this._scrollRestoreRaf = null;
          this._scrollRestoreY = null;
          const maxY = this.xterm.buffer.active.baseY;
          this.xterm.scrollToLine(Math.min(targetY, maxY));
        });
      }

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

      this.summary = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
      this.summaryType = 'ready';
      this.pushDisplayState({
        summary: this.summary,
        summaryType: 'ready',
        exited: true,
      });

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
    this.resizeObserver = new ResizeObserver(() => {
      debouncedResize(this.ptyId, this.xterm, this.fitAddon);
    });
    this.resizeObserver.observe(this.viewportElement);
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
          .map((f) => window.api.getPathForFile(f))
          .filter((p): p is string => !!p)
          .map((p) => (p.includes(' ') ? `"${p}"` : p))
          .join(' ');
        if (paths) this.xterm.paste(paths);
      }
    });
  }

  // ── Data side effects (throttled) ───────────────────────────────────

  private throttledDataSideEffects(data: string): void {
    this.pendingDataChunks.push(data);

    if (this.sideEffectTimer) return;

    this.fireDataSideEffects();

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

    const oscMatches = batch.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
    for (const match of oscMatches) {
      const newTitle = match[1];
      if (newTitle !== this.lastOscTitle) {
        this.lastOscTitle = newTitle;
        this.pushDisplayState({ lastOscTitle: newTitle });
      }
    }

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
    if (this.summaryType !== 'thinking') return;

    if (this.hookThinkingCount > 1 && !this.idleTimer) return;

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.summaryType === 'thinking') {
        this.summaryType = 'ready';
        this.pushDisplayState({ summaryType: 'ready' });
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
}
