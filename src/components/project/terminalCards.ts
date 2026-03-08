/**
 * Project terminal card management - multi-terminal UI, output analysis, card stack
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { PtyId, PtySpawnOptions, RunConfig, WorktreeInfo, ActiveSession } from '../../types';
import {
  ProjectTerminal,
  SummaryType,
  STACK_PAGE_SIZE,
  projectState,
  projectSessions,
} from './state';
import { getTerminalGitPath, hideRunnerPanel, projectRegistry } from './helpers';
import {
  projectPath,
  projectData,
  terminals,
  activeIndex,
  activeStackPage,
  totalStackPages,
  invalidateTaskList,
} from './signals';
import { showToast } from '../importDialog';
import { showHookConfigDialog } from '../hookConfigDialog';
import { refreshTerminalGitStatus, buildCardGitBranchHtml, buildCardGitStatsHtml, scheduleTerminalGitStatusRefresh } from './gitStatus';
import { toggleTerminalDiffPanel, toggleTerminalWorktreeDiffPanel, hideTerminalDiffPanel } from './diffPanel';
import { setSandboxButtonStarting, refreshSandboxButton } from './projectMode';
import { convertIconsIn } from '../../utils/icons';
import { escapeHtml } from '../../utils/html';
import { notifyReady, readyBody } from '../../utils/notifications';

// Platform detection for shortcuts display
const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * Set up custom key handler for a terminal to let app hotkeys pass through.
 * Without this, xterm captures all keys and our hotkeys-js handlers never fire.
 */
export function setupTerminalAppHotkeys(terminal: Terminal): void {
  terminal.attachCustomKeyEventHandler((event) => {
    // Check for the platform-appropriate modifier
    const hasModifier = isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

    if (hasModifier && !event.altKey) {
      const key = event.key.toLowerCase();

      // Linux: Ctrl+Shift+C/V for terminal copy/paste
      // (on Mac, Cmd+C/V work natively without conflicting with Ctrl+C/SIGINT)
      if (!isMac && event.shiftKey && event.type === 'keydown') {
        if (key === 'c') {
          const selection = terminal.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection);
          }
          return false;
        }
        if (key === 'v') {
          event.preventDefault();
          navigator.clipboard.readText().then(text => {
            if (text) {
              terminal.paste(text);
            }
          });
          return false;
        }
      }

      // Mod+Shift+Arrow for page navigation
      if (event.shiftKey && (key === 'arrowleft' || key === 'arrowright')) {
        return false; // Let it bubble up to app hotkey handler
      }

      // App hotkeys that should pass through to hotkeys-js
      const appHotkeys = ['n', 't', 'b', 'i', 'p', 'd', 's', 'w', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      if (appHotkeys.includes(key)) {
        return false; // Don't handle - let it bubble up to app
      }
    }

    return true; // Let xterm handle all other keys (including Escape for TUIs)
  });
}

// Track pending resize timeouts per PTY (debounce rapid resize events)
const pendingResizes = new Map<PtyId, ReturnType<typeof setTimeout>>();
// Track pending rAF per PTY to deduplicate fit() calls
const pendingResizeFrames = new Map<PtyId, number>();

// ── Throttled data handler side-effects ───────────────────────────────
// Per-chunk side-effects (idle timer, OSC title, git status) are throttled
// to fire at most once per 250ms per terminal to reduce CPU overhead.
const SIDE_EFFECT_THROTTLE_MS = 250;
const sideEffectTimers = new Map<PtyId, ReturnType<typeof setTimeout>>();
const pendingDataChunks = new Map<PtyId, string[]>();

function throttledDataSideEffects(
  ptyId: PtyId,
  data: string,
  term: ProjectTerminal,
): void {
  let chunks = pendingDataChunks.get(ptyId);
  if (!chunks) { chunks = []; pendingDataChunks.set(ptyId, chunks); }
  chunks.push(data);

  if (sideEffectTimers.has(ptyId)) return; // Already scheduled, data accumulated

  // Fire immediately (leading edge)
  fireDataSideEffects(ptyId, term);

  // Schedule trailing edge
  sideEffectTimers.set(ptyId, setTimeout(() => {
    sideEffectTimers.delete(ptyId);
    const remaining = pendingDataChunks.get(ptyId);
    if (remaining && remaining.length > 0) {
      fireDataSideEffects(ptyId, term);
    }
  }, SIDE_EFFECT_THROTTLE_MS));
}

function fireDataSideEffects(ptyId: PtyId, term: ProjectTerminal): void {
  resetIdleTimer(ptyId);

  const chunks = pendingDataChunks.get(ptyId) || [];
  const batch = chunks.join('');
  pendingDataChunks.set(ptyId, []);

  // OSC title extraction on batched data
  const oscMatches = batch.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
  for (const match of oscMatches) {
    const newTitle = match[1];
    if (newTitle !== term.lastOscTitle) {
      term.lastOscTitle = newTitle;
      updateTerminalCardLabel(term);
    }
  }

  if (projectPath.value) {
    scheduleTerminalGitStatusRefresh(term, updateTerminalCardLabel);
  }
}

/** Clean up throttle state for a terminal (call on terminal close) */
export function clearDataThrottle(ptyId: PtyId): void {
  const timer = sideEffectTimers.get(ptyId);
  if (timer) clearTimeout(timer);
  sideEffectTimers.delete(ptyId);
  pendingDataChunks.delete(ptyId);
}

/**
 * Debounced resize handler to avoid rapid SIGWINCH signals that cause
 * text wrapping artifacts in shells like zsh during panel animations.
 * Uses rAF to avoid layout thrashing inside ResizeObserver callbacks.
 */
export function debouncedResize(ptyId: PtyId, terminal: Terminal, fitAddon: FitAddon): void {
  // Clear any pending resize for this terminal
  const pending = pendingResizes.get(ptyId);
  if (pending) {
    clearTimeout(pending);
  }

  // Cancel pending rAF for this terminal
  const pendingFrame = pendingResizeFrames.get(ptyId);
  if (pendingFrame) cancelAnimationFrame(pendingFrame);

  // Preserve scroll position across fit() — defer to rAF to avoid layout thrashing
  pendingResizeFrames.set(ptyId, requestAnimationFrame(() => {
    pendingResizeFrames.delete(ptyId);
    scrollSafeFit(terminal, fitAddon);
  }));

  // Debounce the PTY resize signal (50ms delay for animation settling)
  pendingResizes.set(ptyId, setTimeout(() => {
    pendingResizes.delete(ptyId);
    window.api.pty.resize(ptyId, terminal.cols, terminal.rows);
  }, 50));
}

/**
 * Call fitAddon.fit() while preserving the terminal's scroll position.
 * xterm.js resets the viewport to the bottom on reflow; this saves and
 * restores the scroll offset when the user was reading scrollback.
 */
export function scrollSafeFit(terminal: Terminal, fitAddon: FitAddon): void {
  const buf = terminal.buffer.active;
  const atBottom = buf.viewportY >= buf.baseY;
  const savedY = buf.viewportY;

  fitAddon.fit();

  // Only restore if the user had scrolled up — if at bottom, let it follow output
  if (!atBottom) {
    // baseY may have changed after fit, clamp to valid range
    const newY = Math.min(savedY, terminal.buffer.active.baseY);
    terminal.scrollToLine(newY);
  }
}

/**
 * Format a branch name for display (hyphens to spaces)
 */
export function formatBranchNameForDisplay(branch: string): string {
  // Check if it's an old-style agent-timestamp branch
  const agentMatch = branch.match(/^agent-(\d+)$/);
  if (agentMatch) {
    const timestamp = parseInt(agentMatch[1], 10);
    const date = new Date(timestamp);
    return `Untitled ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  // Check if it's a named branch with timestamp suffix
  const namedMatch = branch.match(/^(.+)-\d{10,}$/);
  if (namedMatch) {
    return namedMatch[1].replace(/-/g, ' ');
  }

  // Fallback: just replace hyphens with spaces
  return branch.replace(/-/g, ' ');
}

/** Resolve the display label for a terminal card.
 *  Priority: task name > formatted branch name > fallback */
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
 * Get terminal color theme (dark theme for terminal containers)
 */
export function getTerminalTheme(): Record<string, string> {
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
 * Update the terminal card label with current summary state
 */
export function updateTerminalCardLabel(term: ProjectTerminal): void {
  const labelEl = term.container.querySelector('.project-card-label');
  if (!labelEl) return;

  // Ensure status dot exists
  let dot = labelEl.querySelector('.project-card-status-dot') as HTMLElement;
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'project-card-status-dot';
    if (term.sandboxed) dot.classList.add('project-card-status-dot--sandboxed');
    labelEl.insertBefore(dot, labelEl.firstChild);
  }

  // Update dot color
  dot.setAttribute('data-status', term.summaryType);

  // Update label text
  const labelText = labelEl.querySelector('.project-card-label-text');
  if (labelText) {
    let display = term.label;
    if (term.summary) {
      display += ` — ${term.summary}`;
    }
    labelText.textContent = display;
  }

  // Update OSC title pill
  const labelTop = labelEl.querySelector('.project-card-label-top');
  if (labelTop) {
    let oscPill = labelTop.querySelector('.project-card-osc-title') as HTMLElement;
    if (term.lastOscTitle) {
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
      oscPill.textContent = term.lastOscTitle;
      oscPill.title = term.lastOscTitle;
    } else if (oscPill) {
      oscPill.remove();
    }
  }

  // Update tag pills display
  const tagsRow = labelEl.querySelector('.project-card-tags-row') as HTMLElement;
  if (tagsRow && !tagsRow.querySelector('.tag-input-container')) {
    const tagsHtml = term.tags.map(t => `<span class="project-card-tag-pill">${escapeHtml(t)}</span>`).join('');
    if (tagsRow.dataset.lastHtml !== tagsHtml) {
      tagsRow.dataset.lastHtml = tagsHtml;
      tagsRow.innerHTML = tagsHtml;
    }
  }
  term.container.classList.toggle('project-card--has-tags', term.tags.length > 0);

  // Update git branch display (second line under label)
  const branchRow = labelEl.querySelector('.project-card-git-branch-row') as HTMLElement;
  if (branchRow) {
    const branchHtml = buildCardGitBranchHtml(term.gitStatus);
    if (branchRow.dataset.lastHtml !== branchHtml) {
      branchRow.dataset.lastHtml = branchHtml;
      branchRow.innerHTML = branchHtml;
    }
  }

  // Update git stats display (in label-right)
  const statsWrapper = labelEl.querySelector('.project-card-git-stats-wrapper') as HTMLElement;
  if (statsWrapper) {
    const isWorktree = term.taskId != null && !!term.worktreeBranch;
    const statsHtml = buildCardGitStatsHtml(term.gitStatus, isWorktree);
    if (statsWrapper.dataset.lastHtml !== statsHtml) {
      statsWrapper.dataset.lastHtml = statsHtml;
      statsWrapper.innerHTML = statsHtml;

      const statsEl = statsWrapper.querySelector('.project-card-git-stats--clickable') as HTMLElement;
      if (statsEl) {
        // Restore active state if diff panel is open
        if (term.diffPanelOpen) statsEl.classList.add('card-tab--active');

        // "Compare" button (no uncommitted changes) opens worktree mode;
        // stats pill (has uncommitted changes) opens uncommitted mode
        const isCompareBtn = statsEl.classList.contains('project-card-git-stats--compare');
        statsEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isCompareBtn) {
            toggleTerminalWorktreeDiffPanel(term);
          } else {
            toggleTerminalDiffPanel(term);
          }
        });
      }
    }
  }

  // Sync kanban card status dot if the board is visible
  projectRegistry.syncKanbanStatusDots?.();
}

/**
 * Create a project terminal card element
 */
export function createProjectCard(label: string, index: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.dataset.index = String(index);

  // Card label
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

  // Card body - flex container for terminal viewport and diff panel
  const cardBody = document.createElement('div');
  cardBody.className = 'project-card-body';

  // Terminal viewport
  const viewport = document.createElement('div');
  viewport.className = 'terminal-viewport';

  const xtermContainer = document.createElement('div');
  xtermContainer.className = 'terminal-xterm-container';
  viewport.appendChild(xtermContainer);

  cardBody.appendChild(viewport);
  card.appendChild(cardBody);

  return card;
}

/**
 * Create a loading placeholder card for task creation
 */
export function createLoadingCard(label: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'project-card project-card--loading project-card--active';

  const labelEl = document.createElement('div');
  labelEl.className = 'project-card-label';

  labelEl.innerHTML = `
    <div class="project-card-label-left">
      <div class="project-card-label-top">
        <span class="project-card-status-dot project-card-status-dot--loading"></span>
        <span class="project-card-label-text">${escapeHtml(label || 'New task')}</span>
      </div>
    </div>
    <div class="project-card-label-right"></div>
  `;
  card.appendChild(labelEl);

  const cardBody = document.createElement('div');
  cardBody.className = 'project-card-body';

  const loadingContent = document.createElement('div');
  loadingContent.className = 'project-card-loading-content';
  loadingContent.innerHTML = `
    <div class="project-card-loading-text">Setting up workspace...</div>
  `;

  cardBody.appendChild(loadingContent);
  card.appendChild(cardBody);

  return card;
}

/**
 * Show a loading card and push existing terminals back in the stack
 */
export function showLoadingCardInStack(label: string): HTMLElement {
  const stack = document.querySelector('.project-stack') as HTMLElement;
  if (!stack) throw new Error('Project stack not found');

  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;
  const page = activeStackPage.value;
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, currentTerminals.length);

  // Push existing terminals on the current page back by one position
  currentTerminals.forEach((term, index) => {
    term.container.classList.remove('project-card--active', 'project-card--back-1', 'project-card--back-2', 'project-card--back-3', 'project-card--back-4', 'project-card--hidden');

    if (index < pageStart || index >= pageEnd) {
      term.container.classList.add('project-card--hidden');
    } else if (index === currentActiveIndex) {
      // Active card becomes back-1
      term.container.classList.add('project-card--back-1');
    } else {
      // Calculate current back position within page and increment it
      const diff = index < currentActiveIndex
        ? currentActiveIndex - index
        : (pageEnd - pageStart) - (index - pageStart) + (currentActiveIndex - pageStart);
      // Add 1 to push it back further
      const newBackPosition = Math.min(diff + 1, 4);
      term.container.classList.add(`project-card--back-${newBackPosition}`);
    }
  });

  // Create and add loading card as the new active card
  const loadingCard = createLoadingCard(label);
  stack.appendChild(loadingCard);

  // Adjust stack top position to account for the loading card + existing cards on this page
  const pageCardCount = pageEnd - pageStart;
  const backCardCount = Math.min(pageCardCount, 4);
  const tabSpace = backCardCount * 24;
  stack.style.top = `${82 + tabSpace}px`;

  return loadingCard;
}

/**
 * Remove loading card and restore normal stack positions
 */
export function removeLoadingCard(loadingCard: HTMLElement): void {
  loadingCard.remove();
  // updateCardStack will be called when terminals.value changes
}

/**
 * Set up card action buttons (runner pill for all terminals, close-task for worktrees)
 * Note: Runner pill visibility is controlled by updateCardStack (only shown on active card)
 */
export function setupCardActions(term: ProjectTerminal): void {
  const labelEl = term.container.querySelector('.project-card-label');
  if (!labelEl) return;

  // Right-click context menu for task terminals
  if (term.taskId != null) {
    labelEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCardContextMenu(e as MouseEvent, term);
    });
  }

  // Tag button — works for all terminals (task tags persist, non-task are session-only)
  const tagBtn = labelEl.querySelector('.project-card-tag-btn') as HTMLElement;
  if (tagBtn) {
    tagBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTagInput(term);
    });
  }

  // Wire up runner button click handler
  const runBtn = labelEl.querySelector('.card-tab-run');

  if (runBtn) {
    runBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // If runner is already active, toggle the panel instead of starting new run
      if (term.runnerPtyId) {
        toggleRunnerPanel(term);
      } else {
        await runDefaultInCard(term);
      }
    });
  }
}

/**
 * Show a right-click context menu on a project card header
 */
async function showCardContextMenu(event: MouseEvent, term: ProjectTerminal): Promise<void> {
  // Remove any existing menu
  document.querySelector('.task-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';

  const projPath = projectPath.value;

  // "Open in Terminal" — open a new non-sandboxed terminal for this task
  if (term.worktreePath && term.worktreeBranch) {
    const terminalItem = document.createElement('button');
    terminalItem.className = 'task-context-menu-item';
    terminalItem.innerHTML = '<i data-icon="terminal"></i> Open in Terminal';
    terminalItem.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      addProjectTerminal(undefined, {
        existingWorktree: {
          path: term.worktreePath!,
          branch: term.worktreeBranch!,
          createdAt: '',
        },
        taskId: term.taskId!,
        sandboxed: false,
      });
    });
    menu.appendChild(terminalItem);
  }

  // "Open in Sandbox" — only if lima is available
  if (term.worktreePath && term.worktreeBranch && projPath) {
    const limaStatus = await window.api.lima.status(projPath);
    if (limaStatus.available) {
      const sandboxItem = document.createElement('button');
      sandboxItem.className = 'task-context-menu-item';
      sandboxItem.innerHTML = '<i data-icon="cube"></i> Open in Sandbox';
      sandboxItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        addProjectTerminal(undefined, {
          existingWorktree: {
            path: term.worktreePath!,
            branch: term.worktreeBranch!,
            createdAt: '',
          },
          taskId: term.taskId!,
          sandboxed: true,
        });
      });
      menu.appendChild(sandboxItem);
    }
  }

  // "Open in Editor" — only if editor hook is configured
  if (term.worktreePath && projPath) {
    try {
      const hooks = await window.api.hooks.get(projPath);
      if (hooks.editor) {
        const editorItem = document.createElement('button');
        editorItem.className = 'task-context-menu-item';
        editorItem.innerHTML = '<i data-icon="code"></i> Open in Editor';
        editorItem.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.remove();
          window.api.openInEditor(projPath, term.worktreePath!);
        });
        menu.appendChild(editorItem);
      }
    } catch { /* no hooks configured */ }
  }

  // Separator before close
  const separator = document.createElement('div');
  separator.className = 'task-context-menu-separator';
  menu.appendChild(separator);

  // "Close Task"
  const closeItem = document.createElement('button');
  closeItem.className = 'task-context-menu-item';
  closeItem.innerHTML = '<i data-icon="archive"></i> Close Task';
  closeItem.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    closeTaskFromTerminal(term);
  });
  menu.appendChild(closeItem);

  document.body.appendChild(menu);
  convertIconsIn(menu);

  // Position at mouse, keeping within viewport
  const menuWidth = 200;
  const itemCount = menu.querySelectorAll('.task-context-menu-item').length;
  const separatorCount = menu.querySelectorAll('.task-context-menu-separator').length;
  const menuHeight = 32 * itemCount + 9 * separatorCount;
  const x = Math.min(event.clientX, window.innerWidth - menuWidth);
  const y = Math.min(event.clientY, window.innerHeight - menuHeight);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  requestAnimationFrame(() => menu.classList.add('task-context-menu--visible'));

  // Dismiss on click outside
  const dismiss = (e: MouseEvent) => {
    if (menu.contains(e.target as Node)) return;
    menu.classList.remove('task-context-menu--visible');
    setTimeout(() => menu.remove(), 100);
    document.removeEventListener('mousedown', dismiss);
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

/**
 * Update the runner button appearance based on runner state
 */
export function updateRunnerPill(term: ProjectTerminal): void {
  const btn = term.container.querySelector('.card-tab-run') as HTMLElement;
  if (!btn) return;

  // Reset status classes
  btn.classList.remove('card-tab-run--running', 'card-tab-run--success', 'card-tab-run--error');

  if (term.runnerPtyId) {
    // Toggle active state based on panel visibility
    btn.classList.toggle('card-tab--active', term.runnerPanelOpen);

    switch (term.runnerStatus) {
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

/**
 * Close a task from its terminal card
 */
async function closeTaskFromTerminal(term: ProjectTerminal): Promise<void> {
  if (term.taskId == null) return;

  const path = projectPath.value;
  if (!path) return;

  const result = await window.api.task.setStatus(path, term.taskId, 'done');
  if (result.success) {
    // Close this terminal
    const idx = terminals.value.indexOf(term);
    if (idx !== -1) {
      closeProjectTerminal(idx);
    }
    showToast('Task closed', 'success');
    invalidateTaskList();
  } else {
    showToast(result.error || 'Failed to close task', 'error');
  }
}

/**
 * Build HTML for the runner panel
 */
function buildRunnerPanelHtml(label: string, fullWidth: boolean): string {
  const icon = fullWidth ? 'split-horizontal' : 'arrows-out';
  const title = fullWidth ? 'Split view' : 'Full width';
  return `
    <div class="runner-panel${fullWidth ? ' runner-panel--full' : ''}">
      <div class="runner-panel-header">
        <span class="runner-panel-title">${label}</span>
        <button class="runner-panel-kill" title="Kill"><i data-icon="prohibit"></i></button>
        <button class="runner-panel-restart" title="Restart"><i data-icon="arrow-counter-clockwise"></i></button>
        <button class="runner-panel-split-toggle" title="${title}"><i data-icon="${icon}"></i></button>
        <button class="runner-panel-collapse" title="Minimize panel"><i data-icon="minus"></i></button>
      </div>
      <div class="runner-panel-body">
        <div class="runner-xterm-container"></div>
      </div>
    </div>
  `;
}

/**
 * Set up drag interaction for the runner resize handle.
 * Returns a cleanup function to remove listeners.
 */
function setupRunnerResizeHandle(term: ProjectTerminal, handle: HTMLElement, panel: HTMLElement): () => void {
  const cardBody = term.container.querySelector('.project-card-body') as HTMLElement;
  if (!cardBody) return () => {};

  let dragging = false;

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    dragging = true;
    // Disable CSS transition during drag for smooth tracking
    panel.style.transition = 'none';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const rect = cardBody.getBoundingClientRect();
    const handleWidth = handle.offsetWidth;
    // Mouse position relative to card body, accounting for handle
    const totalWidth = rect.width - handleWidth;
    const mouseX = e.clientX - rect.left;
    // Runner is on the right, so runner ratio = 1 - (mouseX / totalWidth)
    let ratio = 1 - (mouseX / totalWidth);
    // Clamp to [0.15, 0.85]
    ratio = Math.max(0.15, Math.min(0.85, ratio));
    term.runnerSplitRatio = ratio;
    panel.style.flexBasis = `${ratio * 100}%`;
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    // Restore CSS transition
    panel.style.transition = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  handle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  return () => {
    handle.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
}

/**
 * Show the runner panel for a terminal
 */
export function showRunnerPanel(term: ProjectTerminal): void {
  if (term.runnerPanelOpen || !term.runnerPtyId) return;

  // Close diff panel if open (mutual exclusivity)
  if (term.diffPanelOpen) {
    hideTerminalDiffPanel(term);
  }

  const cardBody = term.container.querySelector('.project-card-body') as HTMLElement;
  if (!cardBody) return;

  // Add runner-split class for min-width constraints
  cardBody.classList.add('runner-split');
  // Toggle full-width class on card body
  cardBody.classList.toggle('runner-full', term.runnerFullWidth);

  // Check if panel already exists
  let panel = cardBody.querySelector('.runner-panel') as HTMLElement;
  if (!panel) {
    // Create resize handle
    const handle = document.createElement('div');
    handle.className = 'runner-resize-handle';

    // Insert handle before the runner panel position (after viewport)
    const viewport = cardBody.querySelector('.terminal-viewport');
    if (viewport) {
      viewport.after(handle);
    }

    // Create panel (insert at end so it appears on the right)
    cardBody.insertAdjacentHTML('beforeend', buildRunnerPanelHtml(term.runnerCommand || term.runnerLabel || 'Runner', term.runnerFullWidth));
    panel = cardBody.querySelector('.runner-panel') as HTMLElement;
    if (!panel) return;

    // Render icons in the panel header
    convertIconsIn(panel);

    // Wire up collapse button (hides panel but keeps runner alive)
    const collapseBtn = panel.querySelector('.runner-panel-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideRunnerPanel(term);
      });
    }

    // Wire up kill button (stops runner and removes panel)
    const killBtn = panel.querySelector('.runner-panel-kill');
    if (killBtn) {
      killBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        killRunner(term);
      });
    }

    // Wire up restart button (re-runs the run hook)
    const restartBtn = panel.querySelector('.runner-panel-restart');
    if (restartBtn) {
      restartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        restartRunner(term);
      });
    }

    // Wire up split toggle button
    const splitToggleBtn = panel.querySelector('.runner-panel-split-toggle');
    if (splitToggleBtn) {
      splitToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleRunnerFullWidth(term);
      });
    }

    // Attach xterm if we have a runner terminal
    if (term.runnerTerminal) {
      const xtermContainer = panel.querySelector('.runner-xterm-container') as HTMLElement;
      if (xtermContainer) {
        term.runnerTerminal.open(xtermContainer);

        // Enable native drag/drop on the runner terminal (only once per container)
        if (!xtermContainer.dataset.dragDropSetup) {
          xtermContainer.dataset.dragDropSetup = 'true';
          const setupRunnerDragDrop = (container: HTMLElement, runnerTerm: Terminal) => {
            const screen = container.querySelector('.xterm-screen');
            const target = screen || container;

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
                if (paths) {
                  runnerTerm.paste(paths);
                }
              }
            });
          };
          setupRunnerDragDrop(xtermContainer, term.runnerTerminal);
        }

        // Set up ResizeObserver on runner xterm container
        term.runnerResizeObserver = new ResizeObserver(() => {
          if (term.runnerPtyId && term.runnerTerminal && term.runnerFitAddon) {
            debouncedResize(term.runnerPtyId, term.runnerTerminal, term.runnerFitAddon);
          }
        });
        term.runnerResizeObserver.observe(xtermContainer);
      }
    }

    // Set up resize handle drag interaction
    term.runnerResizeCleanup = setupRunnerResizeHandle(term, handle, panel);
  } else {
    // Re-opening existing panel — make sure resize handle is visible again
    const handle = cardBody.querySelector('.runner-resize-handle') as HTMLElement;
    if (handle) handle.style.display = '';
  }

  term.runnerPanelOpen = true;

  // Mark run button as active
  const runBtn = term.container.querySelector('.card-tab-run');
  if (runBtn) runBtn.classList.add('card-tab--active');

  if (term.runnerFullWidth) {
    // Full-width: appear instantly, no slide animation
    panel.style.transition = 'none';
    panel.classList.add('runner-panel--visible');
    panel.style.flexBasis = '100%';
    requestAnimationFrame(() => {
      panel.style.transition = '';
      if (term.runnerFitAddon && term.runnerPtyId) {
        term.runnerFitAddon.fit();
        window.api.pty.resize(term.runnerPtyId, term.runnerTerminal!.cols, term.runnerTerminal!.rows);
        term.runnerTerminal!.focus();
      }
    });
  } else {
    // Split mode: animate open via flex-basis transition
    requestAnimationFrame(() => {
      panel.classList.add('runner-panel--visible');
      panel.style.flexBasis = `${term.runnerSplitRatio * 100}%`;
    });
    setTimeout(() => {
      if (term.runnerFitAddon && term.runnerPtyId) {
        term.runnerFitAddon.fit();
        window.api.pty.resize(term.runnerPtyId, term.runnerTerminal!.cols, term.runnerTerminal!.rows);
        term.runnerTerminal!.focus();
      }
      term.fitAddon.fit();
      window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
    }, 250);
  }
}


/**
 * Toggle the runner panel visibility
 */
export function toggleRunnerPanel(term: ProjectTerminal): void {
  if (term.runnerPanelOpen) {
    hideRunnerPanel(term);
  } else {
    showRunnerPanel(term);
  }
}

/**
 * Toggle runner panel between full-width and split mode
 */
function toggleRunnerFullWidth(term: ProjectTerminal): void {
  term.runnerFullWidth = !term.runnerFullWidth;

  const panel = term.container.querySelector('.runner-panel') as HTMLElement;
  if (!panel) return;

  // Disable transition for instant swap
  panel.style.transition = 'none';

  // Toggle full-width class on card body
  const cardBody = term.container.querySelector('.project-card-body');
  if (cardBody) cardBody.classList.toggle('runner-full', term.runnerFullWidth);

  // Update toggle button icon
  const toggleBtn = panel.querySelector('.runner-panel-split-toggle') as HTMLElement;

  if (term.runnerFullWidth) {
    panel.classList.add('runner-panel--full');
    panel.style.flexBasis = '100%';
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i data-icon="split-horizontal"></i>';
      toggleBtn.title = 'Split view';
    }
  } else {
    panel.classList.remove('runner-panel--full');
    panel.style.flexBasis = `${term.runnerSplitRatio * 100}%`;
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i data-icon="arrows-out"></i>';
      toggleBtn.title = 'Full width';
    }
  }

  // Re-render icons for the updated button
  if (toggleBtn) {
    convertIconsIn(toggleBtn);
  }

  // Force layout, then restore transition and fit terminals
  requestAnimationFrame(() => {
    panel.style.transition = '';
    if (term.runnerFitAddon && term.runnerPtyId && term.runnerTerminal) {
      term.runnerFitAddon.fit();
      window.api.pty.resize(term.runnerPtyId, term.runnerTerminal.cols, term.runnerTerminal.rows);
    }
    if (!term.runnerFullWidth) {
      term.fitAddon.fit();
      window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
    }
  });
}

/**
 * Kill the runner process and clean up resources
 */
export function killRunner(term: ProjectTerminal): void {
  if (!term.runnerPtyId) return;

  // Mark panel closed and remove active state (skip hideRunnerPanel to avoid stale timeout)
  term.runnerPanelOpen = false;
  const runBtn = term.container.querySelector('.card-tab-run');
  if (runBtn) runBtn.classList.remove('card-tab--active');

  // Kill PTY
  window.api.pty.kill(term.runnerPtyId);

  // Clean up listeners
  if (term.runnerCleanupData) term.runnerCleanupData();
  if (term.runnerCleanupExit) term.runnerCleanupExit();

  // Clean up resize observer and drag listeners
  if (term.runnerResizeObserver) {
    term.runnerResizeObserver.disconnect();
    term.runnerResizeObserver = null;
  }
  if (term.runnerResizeCleanup) {
    term.runnerResizeCleanup();
    term.runnerResizeCleanup = null;
  }

  // Dispose terminal
  if (term.runnerTerminal) {
    term.runnerTerminal.dispose();
  }

  // Remove resize handle DOM
  const handle = term.container.querySelector('.runner-resize-handle');
  if (handle) handle.remove();

  // Remove panel DOM
  const panel = term.container.querySelector('.runner-panel');
  if (panel) panel.remove();

  // Remove runner-split class from card body
  const cardBody = term.container.querySelector('.project-card-body');
  if (cardBody) cardBody.classList.remove('runner-split', 'runner-full');

  // Reset state
  term.runnerPtyId = null;
  term.runnerTerminal = null;
  term.runnerFitAddon = null;
  term.runnerLabel = '';
  term.runnerCommand = null;
  term.runnerStatus = 'idle';
  term.runnerCleanupData = null;
  term.runnerCleanupExit = null;
  term.runnerFullWidth = true;

  // Collapse the pill
  updateRunnerPill(term);
}

/**
 * Restart the runner — kill current process and re-run the run hook
 */
async function restartRunner(term: ProjectTerminal): Promise<void> {
  const wasFullWidth = term.runnerFullWidth;
  killRunner(term);
  await runDefaultInCard(term);
  // Restore full-width preference and show panel
  term.runnerFullWidth = wasFullWidth;
  showRunnerPanel(term);
}

/**
 * Kill any existing terminals or runners that are running the same command.
 * This ensures only one instance of a command runs at a time.
 */
export function killExistingCommandInstances(command: string): void {
  const currentTerminals = terminals.value;

  // First, kill any runners with the same command
  for (const term of currentTerminals) {
    if (term.runnerCommand === command) {
      killRunner(term);
    }
  }

  // Then, close any terminals running the same command (in reverse order to avoid index issues)
  for (let i = currentTerminals.length - 1; i >= 0; i--) {
    if (currentTerminals[i].command === command) {
      closeProjectTerminal(i);
    }
  }
}


/**
 * Run the run hook as a hidden runner
 */
export async function runDefaultInCard(term: ProjectTerminal): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  // If runner already active, kill it first
  if (term.runnerPtyId) {
    killRunner(term);
  }

  // Fetch run hook and settings
  const [hooks, settings] = await Promise.all([
    window.api.hooks.get(path),
    window.api.getProjectSettings(path),
  ]);

  if (!hooks.run) {
    // Open config dialog directly when no run hook is set
    const result = await showHookConfigDialog(path, 'run', undefined, {
      killExistingOnRun: settings.killExistingOnRun,
    });
    if (result?.saved && result.hook) {
      showToast('Run hook configured', 'success');
      // Run it now that it's configured
      await runDefaultInCard(term);
    }
    return;
  }

  const runHook = hooks.run;

  // Kill any existing terminals or runners with the same command (unless disabled)
  if (settings.killExistingOnRun !== false) {
    killExistingCommandInstances(runHook.command);
  }

  // Set initial runner state
  term.runnerLabel = runHook.name;
  term.runnerCommand = runHook.command;
  term.runnerStatus = 'running';

  // Create hidden terminal for runner output
  const runnerTerminal = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: 'Iosevka Term Extended, SF Mono, Monaco, Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: false,
    cursorStyle: 'bar',
    allowTransparency: false,
    scrollback: 2000,
  });

  const runnerFitAddon = new FitAddon();
  runnerTerminal.loadAddon(runnerFitAddon);
  runnerTerminal.loadAddon(new WebLinksAddon((_event, uri) => {
    window.api.openExternal(uri);
  }));

  // Let app hotkeys pass through xterm
  setupTerminalAppHotkeys(runnerTerminal);

  term.runnerTerminal = runnerTerminal;
  term.runnerFitAddon = runnerFitAddon;

  // Spawn PTY for the runner - use worktree path if available, otherwise project path
  const cwd = term.worktreePath || path;
  const spawnOptions: PtySpawnOptions = {
    cwd,
    projectPath: path,  // Use main project path for session grouping during restore
    command: runHook.command,
    cols: 80,  // Default size, will be resized when panel opens
    rows: 24,
    label: runHook.name,
    worktreePath: term.worktreePath,
    isRunner: true,
    parentPtyId: term.ptyId,
    env: {
      OUIJIT_HOOK_TYPE: 'run',
      OUIJIT_PROJECT_PATH: path,
      ...(term.worktreePath && { OUIJIT_WORKTREE_PATH: term.worktreePath }),
      ...(term.worktreeBranch && { OUIJIT_TASK_BRANCH: term.worktreeBranch }),
      ...(term.label && { OUIJIT_TASK_NAME: term.label }),
      ...(term.taskPrompt && { OUIJIT_TASK_PROMPT: term.taskPrompt }),
    },
  };

  try {
    const result = await window.api.pty.spawn(spawnOptions);

    if (!result.success || !result.ptyId) {
      runnerTerminal.writeln(`\x1b[31mFailed to start runner: ${result.error || 'Unknown error'}\x1b[0m`);
      term.runnerStatus = 'error';
      updateRunnerPill(term);
      return;
    }

    term.runnerPtyId = result.ptyId;

    // Set up data listener
    term.runnerCleanupData = window.api.pty.onData(result.ptyId, (data) => {
      runnerTerminal.write(data);

      // Extract OSC title sequences to update runner label
      const oscMatches = data.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
      for (const match of oscMatches) {
        if (match[1]) {
          term.runnerLabel = match[1];
          updateRunnerPill(term);
          // Update panel title if visible
          const panelTitle = term.container.querySelector('.runner-panel-title');
          if (panelTitle) {
            panelTitle.textContent = match[1];
          }
        }
      }
    });

    // Set up exit listener
    term.runnerCleanupExit = window.api.pty.onExit(result.ptyId, (exitCode) => {
      runnerTerminal.writeln('');
      const exitColor = exitCode === 0 ? '32' : '31';
      runnerTerminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);

      term.runnerStatus = exitCode === 0 ? 'success' : 'error';
      updateRunnerPill(term);
    });

    // Forward terminal input to PTY
    runnerTerminal.onData((data) => {
      if (term.runnerPtyId) {
        window.api.pty.write(term.runnerPtyId, data);
      }
    });

    // Update pill to show running state
    updateRunnerPill(term);

  } catch (error) {
    runnerTerminal.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    term.runnerStatus = 'error';
    updateRunnerPill(term);
  }
}

/**
 * Update card stack visual positions (page-scoped)
 */
export function updateCardStack(): void {
  const stack = document.querySelector('.project-stack') as HTMLElement;
  if (!stack) return;

  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;
  const page = activeStackPage.value;
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, currentTerminals.length);
  const pageSize = pageEnd - pageStart;

  // Calculate stack top based on actual back cards on this page
  const pages = totalStackPages.value;
  const backCardCount = Math.max(Math.min(pageSize - 1, 4), 0);
  const tabSpace = backCardCount * 24;
  stack.style.top = `${82 + tabSpace}px`;

  // First pass: calculate back positions for cards on the current page
  const backPositions: { index: number; diff: number }[] = [];
  currentTerminals.forEach((term, index) => {
    // Remove all position classes
    term.container.classList.remove('project-card--active', 'project-card--back-1', 'project-card--back-2', 'project-card--back-3', 'project-card--back-4', 'project-card--hidden');

    if (index < pageStart || index >= pageEnd) {
      // Card is on a different page — hide it
      term.container.classList.add('project-card--hidden');
    } else if (index === currentActiveIndex) {
      term.container.classList.add('project-card--active');
    } else {
      // Calculate back position relative to active within this page
      const diff = index < currentActiveIndex ? currentActiveIndex - index : pageSize - (index - pageStart) + (currentActiveIndex - pageStart);
      const backClass = `project-card--back-${Math.min(diff, 4)}`;
      term.container.classList.add(backClass);
      backPositions.push({ index, diff });
    }
  });

  // Sort by diff descending (highest diff = bottom of stack = ⌘1)
  backPositions.sort((a, b) => b.diff - a.diff);

  // Second pass: assign shortcuts and toggle runner button visibility
  currentTerminals.forEach((term, index) => {
    const shortcutEl = term.container.querySelector('.project-card-shortcut') as HTMLElement;
    const runnerBtn = term.container.querySelector('.card-tab-run') as HTMLElement;

    if (index < pageStart || index >= pageEnd) {
      // Hidden card — no shortcut or runner
      if (shortcutEl) shortcutEl.style.display = 'none';
      if (runnerBtn) runnerBtn.style.display = 'none';
    } else if (index === currentActiveIndex) {
      // Active card: hide shortcut, show runner button
      if (shortcutEl) shortcutEl.style.display = 'none';
      if (runnerBtn) runnerBtn.style.display = '';
    } else {
      // Back card on current page: show shortcut, hide runner button
      if (shortcutEl) {
        const stackPosition = backPositions.findIndex(bp => bp.index === index);
        if (stackPosition !== -1 && stackPosition < 9) {
          shortcutEl.innerHTML = isMac
            ? `⌘<span class="shortcut-number">${stackPosition + 1}</span>`
            : `Ctrl+<span class="shortcut-number">${stackPosition + 1}</span>`;
          shortcutEl.style.display = '';
        } else {
          shortcutEl.style.display = 'none';
        }
      }
      if (runnerBtn) runnerBtn.style.display = 'none';
    }
  });

  // Update pagination arrows
  updatePaginationArrows(stack);
}

/**
 * Get the terminal index for a given stack position (1 = bottom, 2 = second from bottom, etc.)
 * Only considers terminals on the current page.
 * Returns -1 if no terminal at that position
 */
export function getTerminalIndexByStackPosition(stackPosition: number): number {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;
  const page = activeStackPage.value;
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, currentTerminals.length);
  const pageSize = pageEnd - pageStart;

  if (currentTerminals.length === 0) return -1;

  // Build back positions array for current page only
  const backPositions: { index: number; diff: number }[] = [];
  for (let index = pageStart; index < pageEnd; index++) {
    if (index !== currentActiveIndex) {
      const diff = index < currentActiveIndex ? currentActiveIndex - index : pageSize - (index - pageStart) + (currentActiveIndex - pageStart);
      backPositions.push({ index, diff });
    }
  }

  // Sort by diff descending (highest diff = bottom of stack = position 1)
  backPositions.sort((a, b) => b.diff - a.diff);

  // stackPosition is 1-indexed (⌘1 = position 1 = bottom)
  const arrayIndex = stackPosition - 1;
  if (arrayIndex >= 0 && arrayIndex < backPositions.length) {
    return backPositions[arrayIndex].index;
  }

  return -1;
}

/**
 * Switch to a specific project terminal
 */
export function switchToProjectTerminal(index: number): void {
  const currentTerminals = terminals.value;
  if (index < 0 || index >= currentTerminals.length || index === activeIndex.value) return;

  // Collapse any open tag input on the previous active card
  const prev = currentTerminals[activeIndex.value];
  if (prev) collapseTagInput(prev);

  // Set the new active index - effects will handle updateCardStack, focus, and resize
  activeIndex.value = index;
}

/**
 * Select item at stack position (1-indexed)
 * Handles both terminal switching and opening tasks from empty state
 */
export function selectByStackPosition(position: number): void {
  const currentTerminals = terminals.value;
  if (currentTerminals.length === 0) return;

  const targetIndex = getTerminalIndexByStackPosition(position);
  if (targetIndex !== -1) {
    switchToProjectTerminal(targetIndex);
  }
}

/**
 * Options for adding a project terminal
 */
export interface AddProjectTerminalOptions {
  useWorktree?: boolean;
  existingWorktree?: WorktreeInfo & { prompt?: string; sandboxed?: boolean };
  worktreeName?: string;
  worktreePrompt?: string;
  worktreeBranchName?: string;
  sandboxed?: boolean;
  taskId?: number;
  /** Skip automatic start/continue hook lookup — caller handles hooks explicitly */
  skipAutoHook?: boolean;
  /** Create terminal in background without navigating to it */
  background?: boolean;
}

/**
 * Add a new project terminal
 */
export async function addProjectTerminal(runConfig?: RunConfig, options?: AddProjectTerminalOptions): Promise<boolean> {
  const currentProjectPath = projectPath.value;
  const currentTerminals = terminals.value;

  if (!currentProjectPath) {
    return false;
  }

  const stack = document.querySelector('.project-stack');
  if (!stack) return false;

  let terminalCwd = currentProjectPath;
  let worktreeInfo: (WorktreeInfo & { prompt?: string }) | undefined = options?.existingWorktree;
  let loadingCard: HTMLElement | null = null;
  let taskPrompt: string | undefined = options?.existingWorktree?.prompt;

  // Show loading card immediately if creating a new worktree
  if (options?.useWorktree && !worktreeInfo) {
    const loadingLabel = options.worktreeName || 'New task';

    // Hide empty state if visible
    const emptyState = stack.querySelector('.project-stack-empty') as HTMLElement;
    if (emptyState) {
      emptyState.classList.remove('project-stack-empty--visible');
    }

    // Show loading card in the stack (pushes existing cards back)
    loadingCard = showLoadingCardInStack(loadingLabel);

    // Create task and worktree
    const result = await window.api.task.createAndStart(currentProjectPath, options.worktreeName, options.worktreePrompt, options.worktreeBranchName);
    if (!result.success || !result.task || !result.worktreePath) {
      removeLoadingCard(loadingCard);
      // Restore stack positions
      updateCardStack();
      // Re-show empty state if no terminals
      if (terminals.value.length === 0 && emptyState) {
        emptyState.classList.add('project-stack-empty--visible');
      }
      showToast(result.error || 'Failed to create task', 'error');
      return false;
    }
    worktreeInfo = {
      path: result.worktreePath,
      branch: result.task.branch || '',
      createdAt: result.task.createdAt,
    };
    taskPrompt = options.worktreePrompt;
    // Persist sandbox preference for new task
    if (options?.sandboxed !== undefined) {
      await window.api.task.setSandboxed(currentProjectPath, result.task.taskNumber, options.sandboxed);
    }
    // Store taskId for the new task
    if (!options) options = {};
    options.taskId = result.task.taskNumber;
    invalidateTaskList();
  }

  // Use worktree path if we have one
  if (worktreeInfo) {
    terminalCwd = worktreeInfo.path;
  }

  // Look up current task name from API (single source of truth)
  let taskName: string | undefined;
  if (options?.taskId != null) {
    const task = await window.api.task.getByNumber(currentProjectPath, options.taskId);
    taskName = task?.name;
  }
  const label = resolveTerminalLabel(taskName, worktreeInfo?.branch, runConfig?.name);
  const command = runConfig?.command;
  const index = currentTerminals.length;

  // Remove loading card if present, then create real card
  if (loadingCard) {
    removeLoadingCard(loadingCard);
  }

  // Create card element
  const card = createProjectCard(label, index);
  stack.appendChild(card);

  // Render icons now that card is in the DOM
  convertIconsIn(card);

  const xtermContainer = card.querySelector('.terminal-xterm-container') as HTMLElement;
  const closeBtn = card.querySelector('.project-card-close') as HTMLButtonElement;

  // Initialize xterm
  const terminal = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: 'Iosevka Term Extended, SF Mono, Monaco, Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowTransparency: false,
    scrollback: 2000,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon((_event, uri) => {
    window.api.openExternal(uri);
  }));
  terminal.open(xtermContainer);

  // Let app hotkeys pass through xterm
  setupTerminalAppHotkeys(terminal);

  // Enable native drag/drop on the terminal
  // xterm.js creates a .xterm-screen element that captures all mouse events,
  // so we need to attach handlers there after the terminal opens
  const setupDragDrop = (container: HTMLElement, term: Terminal) => {
    const screen = container.querySelector('.xterm-screen');
    const target = screen || container;

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
        if (paths) {
          term.paste(paths);
        }
      }
    });
  };
  setupDragDrop(xtermContainer, terminal);

  await new Promise(resolve => requestAnimationFrame(resolve));
  fitAddon.fit();

  // For sandbox opens without a loading card, add the terminal to signals immediately
  // so the card is fully integrated into the stack (hotkeys, cycling, styling)
  // during the slow VM startup. The ptyId gets updated after spawn completes.
  const taskSandboxedEarly = options?.sandboxed ?? options?.existingWorktree?.sandboxed;
  const addedEarly = !loadingCard && taskSandboxedEarly;
  let projectTerminal: ProjectTerminal | null = null;

  if (addedEarly) {
    projectTerminal = {
      ptyId: '' as PtyId,
      projectPath: currentProjectPath,
      command: undefined,
      label,
      terminal,
      fitAddon,
      container: card,
      cleanupData: null,
      cleanupExit: null,
      resizeObserver: null,
      summary: '',
      summaryType: 'ready',
      lastOscTitle: '',
      sandboxed: true,
      taskId: options?.taskId ?? null,
      taskPrompt,
      tags: [],
      worktreePath: worktreeInfo?.path,
      worktreeBranch: worktreeInfo?.branch,
      gitStatus: null,
      diffPanelOpen: false,
      diffPanelFiles: [],
      diffPanelSelectedFile: null,
      diffPanelMode: 'uncommitted',
      runnerPanelOpen: false,
      runnerPtyId: null,
      runnerTerminal: null,
      runnerFitAddon: null,
      runnerLabel: '',
      runnerCommand: null,
      runnerStatus: 'idle',
      runnerCleanupData: null,
      runnerCleanupExit: null,
      runnerFullWidth: true,
      runnerSplitRatio: 0.5,
      runnerResizeObserver: null,
      runnerResizeCleanup: null,
    };

    // Set up close button and card click handlers
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = terminals.value.indexOf(projectTerminal!);
      if (idx !== -1) closeProjectTerminal(idx);
    });
    card.addEventListener('click', () => {
      const idx = terminals.value.indexOf(projectTerminal!);
      if (idx !== -1 && idx !== activeIndex.value) switchToProjectTerminal(idx);
    });

    // Set up card action buttons and sandbox dot
    setupCardActions(projectTerminal);
    const dot = card.querySelector('.project-card-status-dot');
    if (dot) dot.classList.add('project-card-status-dot--sandboxed');

    // Add to signals — effects handle updateCardStack, empty state, focus
    terminals.value = [...terminals.value, projectTerminal];
    if (!options?.background) {
      activeIndex.value = terminals.value.length - 1;
      terminal.focus();
    }
  }

  // Determine command to run - use start/continue hooks for worktree terminals if configured
  // - start hook: runs on new task creation (options.useWorktree)
  // - continue hook: runs when reopening existing task (options.existingWorktree)
  let startCommand = runConfig?.command;
  let startEnv: Record<string, string> | undefined;

  if (worktreeInfo) {
    // Always set task env vars when we have worktree info
    const isNewTask = options?.useWorktree && !options?.existingWorktree;
    const hookType = isNewTask ? 'start' : 'continue';

    startEnv = {
      OUIJIT_HOOK_TYPE: hookType,
      OUIJIT_PROJECT_PATH: currentProjectPath,
      OUIJIT_WORKTREE_PATH: worktreeInfo.path,
      OUIJIT_TASK_BRANCH: worktreeInfo.branch,
      OUIJIT_TASK_NAME: label,
    };
    if (taskPrompt) {
      startEnv.OUIJIT_TASK_PROMPT = taskPrompt;
    }

    // Use start/continue hooks if no explicit command was provided
    if (!runConfig && !options?.skipAutoHook) {
      const hooks = await window.api.hooks.get(currentProjectPath);
      const hook = isNewTask ? hooks.start : hooks.continue;
      if (hook) {
        startCommand = hook.command;
      }
    }
  }

  // Check if sandbox should be used (purely per-task)
  const limaStatus = await window.api.lima.status(currentProjectPath);
  const taskSandboxed = options?.sandboxed ?? options?.existingWorktree?.sandboxed;
  const useSandbox = limaStatus.available && taskSandboxed === true;

  // Spawn PTY
  const spawnOptions: PtySpawnOptions = {
    cwd: terminalCwd,
    projectPath: currentProjectPath,
    command: startCommand,
    cols: terminal.cols,
    rows: terminal.rows,
    label,
    taskId: options?.taskId,
    worktreePath: worktreeInfo?.path,
    env: startEnv,
    sandboxed: useSandbox,
  };

  try {
    // Show progress for sandbox VM startup
    let cleanupProgress: (() => void) | null = null;
    if (useSandbox) {
      setSandboxButtonStarting(true);
      terminal.writeln(`\x1b[90m● Connecting to sandbox…\x1b[0m`);
      cleanupProgress = window.api.lima.onSpawnProgress((msg) => {
        terminal.writeln(`\x1b[90m● ${msg}\x1b[0m`);
      });
    }

    const result = await window.api.pty.spawn(spawnOptions);
    cleanupProgress?.();

    // Refresh sandbox button now that the VM is (or isn't) running
    if (useSandbox) {
      await refreshSandboxButton(currentProjectPath);
    }

    // If terminal was closed during loading (user clicked X), clean up and bail
    if (addedEarly && !terminals.value.includes(projectTerminal!)) {
      if (result.success && result.ptyId) window.api.pty.kill(result.ptyId);
      return false;
    }

    if (!result.success || !result.ptyId) {
      terminal.writeln(`\x1b[31mFailed to start terminal: ${result.error || 'Unknown error'}\x1b[0m`);
      terminal.writeln(`\x1b[90mThis card will close in 10 seconds.\x1b[0m`);
      if (addedEarly && projectTerminal) {
        // Card is in signals — use closeProjectTerminal for clean removal
        setTimeout(() => {
          const idx = terminals.value.indexOf(projectTerminal!);
          if (idx !== -1) closeProjectTerminal(idx);
        }, 10_000);
      } else {
        setTimeout(() => {
          card.remove();
          terminal.dispose();
        }, 10_000);
      }
      return false;
    }

    // If added early, update the existing ProjectTerminal in-place
    if (addedEarly && projectTerminal) {
      projectTerminal.ptyId = result.ptyId;
      projectTerminal.command = startCommand;

      // Set up resize observer
      projectTerminal.resizeObserver = new ResizeObserver(() => {
        debouncedResize(result.ptyId!, terminal, fitAddon);
      });
      projectTerminal.resizeObserver.observe(xtermContainer);

      // Set up data listener (terminal.write is unthrottled, side-effects are throttled)
      projectTerminal.cleanupData = window.api.pty.onData(result.ptyId, (data) => {
        terminal.write(data);
        throttledDataSideEffects(result.ptyId!, data, projectTerminal!);
      });

      // Set up exit listener
      projectTerminal.cleanupExit = window.api.pty.onExit(result.ptyId, (exitCode) => {
        terminal.writeln('');
        const exitColor = exitCode === 0 ? '32' : '31';
        terminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);
        projectTerminal!.summary = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
        projectTerminal!.summaryType = 'ready';
        updateTerminalCardLabel(projectTerminal!);
      });

      // Forward terminal input
      terminal.onData((data) => {
        window.api.pty.write(result.ptyId!, data);
      });

      // Fetch initial git status
      refreshTerminalGitStatus(projectTerminal).then(() => {
        updateTerminalCardLabel(projectTerminal!);
      });

      // Load tags for task terminals
      if (projectTerminal.taskId != null) {
        window.api.tags.getForTask(currentProjectPath, projectTerminal.taskId).then((tags) => {
          projectTerminal!.tags = tags.map(t => t.name);
          updateTerminalCardLabel(projectTerminal!);
        }).catch(() => {});
      }

      terminal.focus();
      return true;
    }

    // Normal path: create ProjectTerminal after spawn
    projectTerminal = {
      ptyId: result.ptyId,
      projectPath: currentProjectPath,
      command: startCommand,
      label,
      terminal,
      fitAddon,
      container: card,
      cleanupData: null,
      cleanupExit: null,
      resizeObserver: null,
      summary: '',
      summaryType: 'ready',
      lastOscTitle: '',
      sandboxed: useSandbox,
      taskId: options?.taskId ?? null,
      taskPrompt,
      tags: [],
      worktreePath: worktreeInfo?.path,
      worktreeBranch: worktreeInfo?.branch,
      // Per-terminal git status and diff panel state
      gitStatus: null,
      diffPanelOpen: false,
      diffPanelFiles: [],
      diffPanelSelectedFile: null,
      diffPanelMode: 'uncommitted',
      // Runner panel state
      runnerPanelOpen: false,
      runnerPtyId: null,
      runnerTerminal: null,
      runnerFitAddon: null,
      runnerLabel: '',
      runnerCommand: null,
      runnerStatus: 'idle',
      runnerCleanupData: null,
      runnerCleanupExit: null,
      runnerFullWidth: true,
      runnerSplitRatio: 0.5,
      runnerResizeObserver: null,
      runnerResizeCleanup: null,
    };

    // Set up resize observer with debouncing to prevent zsh artifacts during animations
    projectTerminal.resizeObserver = new ResizeObserver(() => {
      debouncedResize(result.ptyId!, terminal, fitAddon);
    });
    projectTerminal.resizeObserver.observe(xtermContainer);

    // Set up data listener (terminal.write is unthrottled, side-effects are throttled)
    projectTerminal.cleanupData = window.api.pty.onData(result.ptyId, (data) => {
      terminal.write(data);
      throttledDataSideEffects(result.ptyId!, data, projectTerminal!);
    });

    // Set up exit listener
    projectTerminal.cleanupExit = window.api.pty.onExit(result.ptyId, (exitCode) => {
      terminal.writeln('');
      const exitColor = exitCode === 0 ? '32' : '31';
      terminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);

      // Update summary to show exit status
      projectTerminal!.summary = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
      projectTerminal!.summaryType = 'ready';
      updateTerminalCardLabel(projectTerminal!);
    });

    // Forward terminal input
    terminal.onData((data) => {
      window.api.pty.write(result.ptyId!, data);
    });

    // Close button handler
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = terminals.value.indexOf(projectTerminal!);
      if (idx !== -1) {
        closeProjectTerminal(idx);
      }
    });

    // Card click handler (to bring to front)
    card.addEventListener('click', () => {
      const idx = terminals.value.indexOf(projectTerminal!);
      if (idx !== -1 && idx !== activeIndex.value) {
        switchToProjectTerminal(idx);
      }
    });

    // Set up card action buttons (runner pill, close-task for worktrees)
    setupCardActions(projectTerminal);

    // Mark sandboxed terminals with a ring on the status dot
    if (useSandbox) {
      const dot = card.querySelector('.project-card-status-dot');
      if (dot) {
        dot.classList.add('project-card-status-dot--sandboxed');
      }
    }

    // Fetch initial git status for this terminal
    refreshTerminalGitStatus(projectTerminal).then(() => {
      updateTerminalCardLabel(projectTerminal!);
    });

    // Load tags for task terminals
    if (projectTerminal.taskId != null) {
      window.api.tags.getForTask(currentProjectPath, projectTerminal.taskId).then((tags) => {
        projectTerminal!.tags = tags.map(t => t.name);
        updateTerminalCardLabel(projectTerminal!);
      });
    }

    // Add terminal to list - effects will handle updateCardStack
    terminals.value = [...terminals.value, projectTerminal];
    if (!options?.background) {
      activeIndex.value = terminals.value.length - 1;
      terminal.focus();
    }
    return true;
  } catch (error) {
    if (useSandbox) {
      setSandboxButtonStarting(false);
    }
    terminal.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    if (addedEarly && projectTerminal) {
      // Card is in signals — remove via closeProjectTerminal
      const idx = terminals.value.indexOf(projectTerminal);
      if (idx !== -1) closeProjectTerminal(idx);
    } else {
      card.remove();
      terminal.dispose();
    }
    return false;
  }
}

/**
 * Close a project terminal
 */
export function closeProjectTerminal(index: number): void {
  const currentTerminals = terminals.value;
  if (index < 0 || index >= currentTerminals.length) return;

  const term = currentTerminals[index];

  // Collapse tag input to clean up click-outside listener
  collapseTagInput(term);

  // Kill main PTY
  window.api.pty.kill(term.ptyId);
  clearIdleTimer(term.ptyId);
  clearDataThrottle(term.ptyId);

  // Clean up main terminal
  if (term.cleanupData) term.cleanupData();
  if (term.cleanupExit) term.cleanupExit();
  if (term.resizeObserver) term.resizeObserver.disconnect();
  term.terminal.dispose();

  // Clean up runner if active
  if (term.runnerPtyId) {
    window.api.pty.kill(term.runnerPtyId);
    if (term.runnerCleanupData) term.runnerCleanupData();
    if (term.runnerCleanupExit) term.runnerCleanupExit();
    if (term.runnerResizeObserver) term.runnerResizeObserver.disconnect();
    if (term.runnerResizeCleanup) term.runnerResizeCleanup();
    if (term.runnerTerminal) term.runnerTerminal.dispose();
  }

  term.container.remove();

  // Remove terminal from list (immutable update)
  const newTerminals = currentTerminals.filter((_, i) => i !== index);
  terminals.value = newTerminals;

  // If no terminals left, nothing to adjust
  if (newTerminals.length === 0) {
    return;
  }

  // Adjust active index
  const currentActiveIndex = activeIndex.value;
  if (currentActiveIndex >= newTerminals.length) {
    activeIndex.value = newTerminals.length - 1;
  } else if (index < currentActiveIndex) {
    activeIndex.value = currentActiveIndex - 1;
  }

  // Effects will handle updateCardStack and focus
}

/**
 * Build HTML for the empty state shown when no terminals are open
 */
export function buildEmptyStateHtml(): string {
  return `
    <div class="project-stack-empty">
      <div class="project-stack-empty-message">No active terminals</div>
      <div class="project-stack-empty-hints">
        <span class="project-stack-empty-hint"><span class="project-stack-empty-hint-shortcut">${isMac ? '⌘' : 'Ctrl+'}<span class="shortcut-number">N</span></span>New Task</span>
        <span class="project-stack-empty-hint"><span class="project-stack-empty-hint-shortcut">${isMac ? '⌘' : 'Ctrl+'}<span class="shortcut-number">B</span></span>Board</span>
      </div>
    </div>
  `;
}

/**
 * Show the empty state in the project stack
 */
export function showStackEmptyState(): void {
  const stack = document.querySelector('.project-stack');
  if (!stack) return;

  // Check if empty state already exists
  let emptyState = stack.querySelector('.project-stack-empty') as HTMLElement;
  if (emptyState) {
    requestAnimationFrame(() => {
      emptyState.classList.add('project-stack-empty--visible');
    });
    return;
  }

  // Create and insert empty state
  stack.insertAdjacentHTML('beforeend', buildEmptyStateHtml());
  emptyState = stack.querySelector('.project-stack-empty') as HTMLElement;

  // Animate in
  requestAnimationFrame(() => {
    emptyState.classList.add('project-stack-empty--visible');
  });
}

/**
 * Hide the empty state from the project stack
 */
export function hideStackEmptyState(): void {
  const emptyState = document.querySelector('.project-stack-empty') as HTMLElement;
  if (!emptyState) return;

  emptyState.classList.remove('project-stack-empty--visible');

  // Remove after animation
  setTimeout(() => {
    emptyState.remove();
  }, 200);
}

/**
 * Ensure the fixed-position pagination row exists in the DOM.
 * Created once and reused; hidden/shown by updatePaginationArrows.
 */
function ensurePaginationRow(): HTMLElement {
  let row = document.querySelector('.project-stack-pagination') as HTMLElement;
  if (row) return row;

  row = document.createElement('div');
  row.className = 'project-stack-pagination';
  row.style.display = 'none';

  const leftBtn = document.createElement('button');
  leftBtn.className = 'project-stack-page-arrow';
  leftBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  leftBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateStackPage(-1);
  });

  const indicator = document.createElement('span');
  indicator.className = 'project-stack-page-indicator';

  const rightBtn = document.createElement('button');
  rightBtn.className = 'project-stack-page-arrow';
  rightBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  rightBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateStackPage(1);
  });

  row.appendChild(leftBtn);
  row.appendChild(indicator);
  row.appendChild(rightBtn);
  document.body.appendChild(row);
  return row;
}

/**
 * Update pagination row — show/hide and update content.
 * The row is a fixed-position element anchored below the header.
 */
function updatePaginationArrows(_stack: HTMLElement): void {
  const pages = totalStackPages.value;
  const page = activeStackPage.value;

  if (pages <= 1) {
    const row = document.querySelector('.project-stack-pagination') as HTMLElement;
    if (row) row.style.display = 'none';
    return;
  }

  const row = ensurePaginationRow();
  const buttons = row.querySelectorAll('.project-stack-page-arrow');
  const leftBtn = buttons[0] as HTMLElement;
  const rightBtn = buttons[1] as HTMLElement;
  const indicator = row.querySelector('.project-stack-page-indicator') as HTMLElement;

  row.style.display = '';
  if (leftBtn) leftBtn.style.visibility = page > 0 ? 'visible' : 'hidden';
  if (rightBtn) rightBtn.style.visibility = page < pages - 1 ? 'visible' : 'hidden';
  if (indicator) indicator.textContent = `${page + 1} / ${pages}`;
}

/**
 * Navigate to an adjacent page (-1 = left, 1 = right)
 * Switches activeIndex to the first terminal on the target page
 */
export function navigateStackPage(direction: -1 | 1): void {
  const page = activeStackPage.value;
  const pages = totalStackPages.value;
  const targetPage = page + direction;

  if (targetPage < 0 || targetPage >= pages) return;

  // Set activeIndex to the first terminal on the target page
  const targetIndex = targetPage * STACK_PAGE_SIZE;
  const currentTerminals = terminals.value;
  if (targetIndex >= 0 && targetIndex < currentTerminals.length) {
    activeIndex.value = targetIndex;
  }
}

/**
 * Play or toggle runner for the active terminal (hotkey handler)
 * If runner is active, toggles its panel visibility
 * Otherwise, starts the default command as a runner
 */
async function playOrToggleRunner(): Promise<void> {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length === 0 || currentActiveIndex >= currentTerminals.length) {
    return;
  }

  const activeTerm = currentTerminals[currentActiveIndex];
  if (activeTerm.runnerPtyId) {
    toggleRunnerPanel(activeTerm);
  } else {
    await runDefaultInCard(activeTerm);
  }
}

// ── Idle fallback timer ─────────────────────────────────────────────
// No Claude Code hook fires when Claude presents an elicitation
// (AskUserQuestion). As a fallback, transition to idle when terminal
// output goes silent for IDLE_FALLBACK_MS — but ONLY when no tool has
// run this turn. If any PostToolUse fired (count > 1), Claude is
// actively working (possibly with background agents that run silently
// for minutes). In that case, skip the timer entirely and trust the
// Stop / Notification hooks to signal idle.

const IDLE_FALLBACK_MS = 3000;
const READY_DEFERRAL_MS = 5_000;
const idleTimers = new Map<PtyId, ReturnType<typeof setTimeout>>();
const readyDeferralTimers = new Map<PtyId, ReturnType<typeof setTimeout>>();

// Count of hook "thinking" signals since the last idle transition per ptyId.
// 1 = only UserPromptSubmit fired (possible elicitation coming).
// >1 = PostToolUse fired (tools actively running — don't idle on silence).
const hookThinkingCounts = new Map<PtyId, number>();

/** Increment the thinking hook counter for a ptyId. */
export function trackHookThinking(ptyId: PtyId): void {
  hookThinkingCounts.set(ptyId, (hookThinkingCounts.get(ptyId) || 0) + 1);
}

/** Clear the thinking hook counter (call on idle transition). */
function clearHookThinking(ptyId: PtyId): void {
  hookThinkingCounts.delete(ptyId);
}

function clearReadyDeferral(ptyId: PtyId): void {
  const existing = readyDeferralTimers.get(ptyId);
  if (existing) {
    clearTimeout(existing);
    readyDeferralTimers.delete(ptyId);
  }
}

/**
 * Reset (or start) the idle fallback timer for a terminal.
 * Call on every terminal output event while status is "thinking".
 *
 * When PostToolUse has fired (count > 1), no timer is armed —
 * we rely solely on Stop / Notification hooks (with deferral)
 * to transition to green.
 */
export function resetIdleTimer(ptyId: PtyId): void {
  const term = terminals.value.find(t => t.ptyId === ptyId);
  if (!term || term.summaryType !== 'thinking') return;

  // Tools were used this turn → don't arm the idle timer UNLESS one is
  // already running (post-deferral phase). In that case, re-arm it so
  // terminal output keeps extending the silence window.
  if ((hookThinkingCounts.get(ptyId) || 0) > 1 && !idleTimers.has(ptyId)) return;

  // No tools used (count ≤ 1) → 3s fallback to ready (green).
  // Reset on any terminal output (elicitation detection).
  const existing = idleTimers.get(ptyId);
  if (existing) clearTimeout(existing);
  idleTimers.set(ptyId, setTimeout(() => {
    idleTimers.delete(ptyId);
    const t = terminals.value.find(t => t.ptyId === ptyId);
    if (t && t.summaryType === 'thinking') {
      t.summaryType = 'ready';
      updateTerminalCardLabel(t);
    }
    clearHookThinking(ptyId);
  }, IDLE_FALLBACK_MS));
}

function clearIdleTimer(ptyId: PtyId): void {
  const existing = idleTimers.get(ptyId);
  if (existing) {
    clearTimeout(existing);
    idleTimers.delete(ptyId);
  }
  clearReadyDeferral(ptyId);
  clearHookThinking(ptyId);
}

function clearAllIdleTimers(): void {
  for (const timer of idleTimers.values()) {
    clearTimeout(timer);
  }
  idleTimers.clear();
  for (const timer of readyDeferralTimers.values()) {
    clearTimeout(timer);
  }
  readyDeferralTimers.clear();
  hookThinkingCounts.clear();
}

// ── Global hook status listener ──────────────────────────────────────

let hookStatusCleanup: (() => void) | null = null;

/**
 * Register a single global listener for Claude Code hook status events.
 * Maps ptyId → ProjectTerminal and updates summaryType + card label.
 * Call once when project mode initializes; clean up on exit.
 *
 * When tools were used (count > 1), Stop/Notification hooks use a
 * two-phase transition: first a deferral timer (5s) to catch premature
 * Stop events, then an idle fallback timer (3s) to wait for terminal
 * silence. PostToolUse during either phase cancels the transition.
 */
export function registerHookStatusListener(): void {
  if (hookStatusCleanup) return; // Already registered

  hookStatusCleanup = window.api.claudeHooks.onStatus((ptyId, status) => {
    const term = terminals.value.find(t => t.ptyId === ptyId);
    if (!term) return;
    const projectName = projectData.value?.name ?? 'Ouijit';

    if (status === 'thinking') {
      // PostToolUse / UserPromptSubmit → purple
      clearReadyDeferral(ptyId);
      // Also clear any post-deferral idle timer — a new tool event
      // means Claude is actively working; trust Stop to re-arm later.
      const existingIdle = idleTimers.get(ptyId);
      if (existingIdle) {
        clearTimeout(existingIdle);
        idleTimers.delete(ptyId);
      }

      if (term.summaryType !== 'thinking') {
        // New thinking cycle — reset count
        clearHookThinking(ptyId);
        term.summaryType = 'thinking';
        updateTerminalCardLabel(term);
      }

      trackHookThinking(ptyId);
      resetIdleTimer(ptyId);
    } else {
      // Stop / Notification → ready
      const count = hookThinkingCounts.get(ptyId) || 0;

      if (count > 1 && term.summaryType === 'thinking') {
        // Tools were used and we're actively thinking — Stop/Notification
        // may be premature (main process done but agents still running).
        // Defer the green transition; if PostToolUse fires within the
        // deferral window, it cancels the transition and stays purple.
        const existingIdle = idleTimers.get(ptyId);
        if (existingIdle) {
          clearTimeout(existingIdle);
          idleTimers.delete(ptyId);
        }
        clearReadyDeferral(ptyId);
        readyDeferralTimers.set(ptyId, setTimeout(() => {
          readyDeferralTimers.delete(ptyId);
          const t = terminals.value.find(t => t.ptyId === ptyId);
          if (!t || t.summaryType !== 'thinking') return;
          // Don't go green yet — arm the idle fallback timer to wait
          // for terminal silence. This handles the case where Stop
          // fired but Claude is still producing output (e.g., sub-agents
          // running silently for extended periods).
          const existingIdle = idleTimers.get(ptyId);
          if (existingIdle) clearTimeout(existingIdle);
          idleTimers.set(ptyId, setTimeout(() => {
            idleTimers.delete(ptyId);
            const t2 = terminals.value.find(t2 => t2.ptyId === ptyId);
            if (t2 && t2.summaryType === 'thinking') {
              t2.summaryType = 'ready';
              updateTerminalCardLabel(t2);
              notifyReady(projectName, readyBody(t2.label, t2.lastOscTitle));
            }
            clearHookThinking(ptyId);
          }, IDLE_FALLBACK_MS));
        }, READY_DEFERRAL_MS));
        return;
      }

      // Simple case (no tools used, or already in idle/ready): go green
      if (term.summaryType !== 'ready') {
        term.summaryType = 'ready';
        updateTerminalCardLabel(term);
        notifyReady(projectName, readyBody(term.label, term.lastOscTitle));
      }
      clearIdleTimer(ptyId);
    }
  });
}

/**
 * Unregister the global hook status listener.
 */
export function unregisterHookStatusListener(): void {
  if (hookStatusCleanup) {
    hookStatusCleanup();
    hookStatusCleanup = null;
  }
  clearAllIdleTimers();
}

/**
 * Shared terminal reconnection — creates Terminal + card, reconnects PTY, replays buffer.
 * Returns a ProjectTerminal with data forwarding wired. Callers add their own
 * close-button, card-click, and exit handlers.
 *
 * @param session  - ActiveSession from the main process
 * @param container - DOM element to append the card to
 * @param opts.worktreeBranch - optional branch name for worktree terminals
 * @param opts.onData - optional extra callback when PTY emits data
 */
export async function reconnectTerminal(
  session: ActiveSession,
  container: HTMLElement,
  opts: { worktreeBranch?: string; onData?: (ptyId: PtyId, data: string) => void; initialStatus?: SummaryType } = {},
): Promise<ProjectTerminal | null> {
  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 14,
    fontFamily: 'Iosevka Term Extended, "SF Mono", Menlo, Monaco, monospace',
    lineHeight: 1.2,
    theme: getTerminalTheme(),
    allowTransparency: false,
    scrollback: 2000,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon((_event, uri) => {
    window.api.openExternal(uri);
  }));

  const card = createProjectCard(session.label, 0);
  container.appendChild(card);
  convertIconsIn(card);

  const xtermContainer = card.querySelector('.terminal-xterm-container') as HTMLElement;
  terminal.open(xtermContainer);
  setupTerminalAppHotkeys(terminal);

  // Enable native drag/drop on the terminal
  const screen = xtermContainer.querySelector('.xterm-screen');
  const dragTarget = screen || xtermContainer;
  dragTarget.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if ((e as DragEvent).dataTransfer) {
      (e as DragEvent).dataTransfer!.dropEffect = 'copy';
    }
  });
  dragTarget.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.files.length) {
      const paths = Array.from(dt.files)
        .map(f => window.api.getPathForFile(f))
        .filter((p): p is string => !!p)
        .map(p => p.includes(' ') ? `"${p}"` : p)
        .join(' ');
      if (paths) terminal.paste(paths);
    }
  });

  await new Promise(resolve => requestAnimationFrame(resolve));
  fitAddon.fit();

  // Reconnect to existing PTY
  const result = await window.api.pty.reconnect(session.ptyId);
  if (!result.success) {
    card.remove();
    terminal.dispose();
    return null;
  }

  // Replay buffered output
  if (result.bufferedOutput) {
    terminal.reset();
    terminal.write(result.bufferedOutput);
  }

  // Resize observer
  const resizeObserver = new ResizeObserver(() => {
    debouncedResize(session.ptyId, terminal, fitAddon);
  });
  resizeObserver.observe(xtermContainer);

  // Trigger resize to sync terminal size
  setTimeout(() => {
    debouncedResize(session.ptyId, terminal, fitAddon);
  }, 50);

  const projectTerminal: ProjectTerminal = {
    ptyId: session.ptyId,
    projectPath: session.projectPath,
    command: session.command,
    label: session.label,
    terminal,
    fitAddon,
    container: card,
    cleanupData: null,
    cleanupExit: null,
    resizeObserver,
    summary: '',
    summaryType: opts.initialStatus ?? 'ready',
    lastOscTitle: '',
    sandboxed: !!session.sandboxed,
    taskId: session.taskId ?? null,
    tags: [],
    worktreePath: session.worktreePath,
    worktreeBranch: opts.worktreeBranch,
    gitStatus: null,
    diffPanelOpen: false,
    diffPanelFiles: [],
    diffPanelSelectedFile: null,
    diffPanelMode: (session.taskId != null) ? 'worktree' : 'uncommitted',
    runnerPanelOpen: false,
    runnerPtyId: null,
    runnerTerminal: null,
    runnerFitAddon: null,
    runnerLabel: '',
    runnerCommand: null,
    runnerStatus: 'idle',
    runnerCleanupData: null,
    runnerCleanupExit: null,
    runnerFullWidth: true,
    runnerSplitRatio: 0.5,
    runnerResizeObserver: null,
    runnerResizeCleanup: null,
  };

  // Wire PTY → terminal data flow
  projectTerminal.cleanupData = window.api.pty.onData(session.ptyId, (data) => {
    terminal.write(data);
    opts.onData?.(session.ptyId, data);
  });

  // Wire terminal → PTY input forwarding
  terminal.onData((data) => {
    window.api.pty.write(session.ptyId, data);
  });

  // Load tags for task terminals
  if (projectTerminal.taskId != null) {
    window.api.tags.getForTask(session.projectPath, projectTerminal.taskId).then((tags) => {
      projectTerminal!.tags = tags.map(t => t.name);
      updateTerminalCardLabel(projectTerminal!);
    }).catch(() => {});
  }

  updateTerminalCardLabel(projectTerminal);
  return projectTerminal;
}

// ── Tag autocomplete from active sessions ────────────────────────────

/** Collect unique tags from all active terminal sessions */
function getActiveSessionTags(): { name: string }[] {
  const seen = new Map<string, string>(); // lowercase → original
  for (const [, session] of projectSessions) {
    for (const term of session.terminals) {
      for (const tag of term.tags) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) seen.set(key, tag);
      }
    }
  }
  return Array.from(seen.values()).map(name => ({ name }));
}

// ── Tag input ────────────────────────────────────────────────────────

function toggleTagInput(term: ProjectTerminal): void {
  const tagsRow = term.container.querySelector('.project-card-tags-row') as HTMLElement;
  if (!tagsRow) return;

  if (tagsRow.querySelector('.tag-input-container')) {
    collapseTagInput(term);
  } else {
    expandTagInput(term);
  }
}

function expandTagInput(term: ProjectTerminal): void {
  const tagsRow = term.container.querySelector('.project-card-tags-row') as HTMLElement;
  if (!tagsRow || tagsRow.querySelector('.tag-input-container')) return;

  const container = document.createElement('div');
  container.className = 'tag-input-container';

  // Render existing tags as removable chips
  for (const t of term.tags) {
    container.appendChild(createTagChip(t, term));
  }

  // Text input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input-field';
  input.placeholder = term.tags.length ? '' : 'Add tag…';
  container.appendChild(input);

  // Autocomplete dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'tag-autocomplete-dropdown';
  dropdown.style.display = 'none';
  container.appendChild(dropdown);

  tagsRow.innerHTML = '';
  delete tagsRow.dataset.lastHtml;
  tagsRow.appendChild(container);

  input.focus();

  // Input event handler for autocomplete
  input.addEventListener('input', async () => {
    const value = input.value.trim();
    if (!value) {
      dropdown.style.display = 'none';
      return;
    }
    try {
      const allTags = getActiveSessionTags();
      const existing = new Set(term.tags.map(t => t.toLowerCase()));
      const matches = allTags
        .filter(t => t.name.toLowerCase().includes(value.toLowerCase()) && !existing.has(t.name.toLowerCase()))
        .slice(0, 8);

      if (matches.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      dropdown.innerHTML = '';
      for (const match of matches) {
        const item = document.createElement('div');
        item.className = 'tag-autocomplete-item';
        item.textContent = match.name;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // prevent input blur
          addTag(term, match.name, container, input);
        });
        dropdown.appendChild(item);
      }
      dropdown.style.display = 'block';
    } catch {
      dropdown.style.display = 'none';
    }
  });

  // Key handlers
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = input.value.trim();
      if (value) {
        addTag(term, value, container, input);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      collapseTagInput(term);
    } else if (e.key === 'Backspace' && !input.value && term.tags.length > 0) {
      e.preventDefault();
      const lastTag = term.tags[term.tags.length - 1];
      removeTag(term, lastTag, container);
    }
  });

  // Click outside to collapse (tag button handled by toggleTagInput, so exclude it)
  const tagBtn = term.container.querySelector('.project-card-tag-btn');
  const onClickOutside = (e: MouseEvent) => {
    if (!container.contains(e.target as Node) && !tagBtn?.contains(e.target as Node)) {
      collapseTagInput(term);
      document.removeEventListener('mousedown', onClickOutside);
    }
  };
  // Delay attaching to avoid immediate trigger
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', onClickOutside);
  });

  // Store cleanup reference on the container element
  (container as any)._cleanupClickOutside = onClickOutside;
}

export function collapseTagInput(term: ProjectTerminal): void {
  const tagsRow = term.container.querySelector('.project-card-tags-row') as HTMLElement;
  if (!tagsRow) return;

  const container = tagsRow.querySelector('.tag-input-container');
  if (!container) return;

  const cleanup = (container as any)._cleanupClickOutside;
  if (cleanup) document.removeEventListener('mousedown', cleanup);

  // Remove input container so updateTerminalCardLabel can re-render pills
  container.remove();
  delete tagsRow.dataset.lastHtml;
  updateTerminalCardLabel(term);
}

function createTagChip(tagName: string, term: ProjectTerminal): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.innerHTML = `${escapeHtml(tagName)}<button class="tag-chip-remove" title="Remove tag">&times;</button>`;

  const removeBtn = chip.querySelector('.tag-chip-remove')!;
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const container = chip.closest('.tag-input-container') as HTMLElement;
    if (container) {
      removeTag(term, tagName, container);
    }
  });

  return chip;
}

async function addTag(term: ProjectTerminal, tagName: string, container: HTMLElement, input: HTMLInputElement): Promise<void> {
  const normalized = tagName.trim();
  if (!normalized) return;

  // Same tag already — no-op
  if (term.tags.length === 1 && term.tags[0].toLowerCase() === normalized.toLowerCase()) {
    input.value = '';
    const dropdown = container.querySelector('.tag-autocomplete-dropdown') as HTMLElement;
    if (dropdown) dropdown.style.display = 'none';
    return;
  }

  // Single tag only — replace existing
  if (term.taskId != null) {
    try {
      await window.api.tags.setTaskTags(term.projectPath, term.taskId, [normalized]);
    } catch { /* DB not ready or task gone — still set in-memory */ }
  }
  term.tags = [normalized];


  // Replace all chips with the new one
  container.querySelectorAll('.tag-chip').forEach(c => c.remove());
  const chip = createTagChip(normalized, term);
  container.insertBefore(chip, input);

  input.value = '';
  input.placeholder = '';
  const dropdown = container.querySelector('.tag-autocomplete-dropdown') as HTMLElement;
  if (dropdown) dropdown.style.display = 'none';
}

async function removeTag(term: ProjectTerminal, tagName: string, container: HTMLElement): Promise<void> {
  // Persist for task terminals, in-memory only for non-task
  if (term.taskId != null) {
    try {
      await window.api.tags.removeFromTask(term.projectPath, term.taskId, tagName);
    } catch { /* DB not ready or task gone */ }
  }
  term.tags = term.tags.filter(t => t.toLowerCase() !== tagName.toLowerCase());


  // Remove the chip from DOM
  const chips = container.querySelectorAll('.tag-chip');
  for (const chip of chips) {
    const text = chip.childNodes[0]?.textContent?.trim();
    if (text?.toLowerCase() === tagName.toLowerCase()) {
      chip.remove();
      break;
    }
  }

  // Update placeholder
  const input = container.querySelector('.tag-input-field') as HTMLInputElement;
  if (input && term.tags.length === 0) {
    input.placeholder = 'Add tag…';
  }
}

// Register functions in the project registry for cross-module access
projectRegistry.addProjectTerminal = addProjectTerminal;
projectRegistry.closeProjectTerminal = closeProjectTerminal;
projectRegistry.playOrToggleRunner = playOrToggleRunner;
