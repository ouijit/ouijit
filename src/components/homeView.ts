/**
 * Home view — cross-project terminal multiplexer
 * Shows all active terminals in a single card stack, organized by project
 */

import log from 'electron-log/renderer';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Project, PtyId, PtySpawnOptions } from '../types';
import {
  projectSessions,
  ensureHiddenSessionsContainer,
  STACK_PAGE_SIZE,
  type ProjectTerminal,
} from './project/state';
import { homeViewActive, projectPath } from './project/signals';
import { exitProjectMode } from './project/projectMode';
import { getTerminalTheme, setupTerminalAppHotkeys, updateTerminalCardLabel, createProjectCard } from './project/terminalCards';
import { convertIconsIn } from '../utils/icons';
import { Scopes, pushScope, popScope, registerHotkey, unregisterHotkey, platformHotkey } from '../utils/hotkeys';
import { showToast } from './importDialog';
import { updateSidebarActiveState } from './sidebar';

const homeLog = log.scope('homeView');

// Platform detection for shortcut display
const isMac = navigator.platform.toLowerCase().includes('mac');

// Flat list of all terminals displayed in the home view stack
let homeTerminals: ProjectTerminal[] = [];
let homeActiveIndex = 0;

// Hook status cleanup
let hookStatusCleanup: (() => void) | null = null;

// Track home view stack element
let homeStack: HTMLElement | null = null;

// Project data cache
let projectDataCache = new Map<string, Project>();

/**
 * Enter the home view, showing all terminals in a single card stack
 */
export async function enterHomeView(): Promise<void> {
  if (homeViewActive.value) return;

  if (projectPath.value !== null) {
    exitProjectMode();
  }

  homeLog.info('entering home view', { sessionCount: projectSessions.size });

  homeViewActive.value = true;
  document.body.classList.add('home-mode');

  // Set up home header
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    headerContent.innerHTML = `<div class="project-header-content"><span class="project-header-name" style="font-size: 14px; font-weight: 600; color: var(--color-text-secondary);">Home</span></div>`;
  }

  // Populate project data cache
  try {
    const projects = await window.api.getProjects();
    projectDataCache = new Map(projects.map(p => [p.path, p]));
  } catch {
    // Fall back to data from sessions
  }

  // Create the card stack (same as project mode)
  const mainContent = document.querySelector('.main-content');
  if (!mainContent) return;

  homeStack = document.createElement('div');
  homeStack.className = 'project-stack';
  mainContent.appendChild(homeStack);

  // Build flat terminal list from all sessions, grouped by project
  homeTerminals = [];
  for (const [, session] of projectSessions) {
    for (const term of session.terminals) {
      homeTerminals.push(term);
      stripStackClasses(term.container);
      homeStack.appendChild(term.container);

      // Reconnect resize observer
      if (term.resizeObserver) {
        const xtermContainer = term.container.querySelector('.terminal-xterm-container');
        if (xtermContainer) {
          term.resizeObserver.observe(xtermContainer);
        }
      }
    }
  }

  homeActiveIndex = 0;

  if (homeTerminals.length === 0) {
    showHomeEmptyState();
  } else {
    updateHomeCardStack();
    // Fit the active terminal after layout
    requestAnimationFrame(() => {
      const active = homeTerminals[homeActiveIndex];
      if (active) {
        try { active.fitAddon.fit(); } catch { /* noop */ }
        active.terminal.focus();
      }
    });
  }

  // Wire card click handlers for switching
  wireHomeCardClicks();

  // Register hotkeys
  pushScope(Scopes.HOME);
  registerHotkey(platformHotkey('mod+w'), Scopes.HOME, () => {
    if (homeTerminals.length > 0) {
      closeHomeTerminal(homeActiveIndex);
    }
  });
  for (let i = 1; i <= 9; i++) {
    registerHotkey(platformHotkey(`mod+${i}`), Scopes.HOME, () => {
      selectByHomeStackPosition(i);
    });
  }

  // Register hook status listener
  registerHomeHookStatusListener();

  updateSidebarActiveState();
}

/**
 * Exit the home view, returning terminals to hidden session containers
 */
export function exitHomeView(): void {
  if (!homeViewActive.value) return;

  homeLog.info('exiting home view');

  // Return all terminal cards to their stored stack elements
  for (const [, session] of projectSessions) {
    for (const term of session.terminals) {
      stripStackClasses(term.container);
      session.stackElement.appendChild(term.container);
      if (term.resizeObserver) {
        term.resizeObserver.disconnect();
      }
    }
    const hiddenContainer = ensureHiddenSessionsContainer();
    hiddenContainer.appendChild(session.stackElement);
  }

  // Clean up
  homeStack?.remove();
  homeStack = null;
  homeTerminals = [];
  homeActiveIndex = 0;

  document.body.classList.remove('home-mode');
  homeViewActive.value = false;

  // Clear header
  const headerContent = document.querySelector('.header-content');
  if (headerContent) headerContent.innerHTML = '';

  // Unregister hotkeys
  unregisterHotkey(platformHotkey('mod+w'), Scopes.HOME);
  for (let i = 1; i <= 9; i++) {
    unregisterHotkey(platformHotkey(`mod+${i}`), Scopes.HOME);
  }
  popScope();

  unregisterHomeHookStatusListener();
}

/**
 * Update the card stack visual positions (mirrors updateCardStack from terminalCards.ts)
 */
function updateHomeCardStack(): void {
  if (!homeStack) return;

  const page = Math.floor(homeActiveIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, homeTerminals.length);
  const pageSize = pageEnd - pageStart;

  const backCardCount = Math.max(Math.min(pageSize - 1, 4), 0);
  const tabSpace = backCardCount * 24;
  homeStack.style.top = `${82 + tabSpace}px`;

  const backPositions: { index: number; diff: number }[] = [];

  homeTerminals.forEach((term, index) => {
    stripStackClasses(term.container);

    if (index < pageStart || index >= pageEnd) {
      term.container.classList.add('project-card--hidden');
    } else if (index === homeActiveIndex) {
      term.container.classList.add('project-card--active');
    } else {
      const diff = index < homeActiveIndex
        ? homeActiveIndex - index
        : pageSize - (index - pageStart) + (homeActiveIndex - pageStart);
      const backClass = `project-card--back-${Math.min(diff, 4)}`;
      term.container.classList.add(backClass);
      backPositions.push({ index, diff });
    }
  });

  // Sort by diff descending (highest diff = bottom of stack = ⌘1)
  backPositions.sort((a, b) => b.diff - a.diff);

  // Assign shortcut labels on back card tabs
  homeTerminals.forEach((term, index) => {
    const shortcutEl = term.container.querySelector('.project-card-shortcut') as HTMLElement;
    const runnerBtn = term.container.querySelector('.card-tab-run') as HTMLElement;

    if (index < pageStart || index >= pageEnd) {
      if (shortcutEl) shortcutEl.style.display = 'none';
      if (runnerBtn) runnerBtn.style.display = 'none';
    } else if (index === homeActiveIndex) {
      if (shortcutEl) shortcutEl.style.display = 'none';
      if (runnerBtn) runnerBtn.style.display = '';
    } else {
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
}

/**
 * Wire click handlers on cards for switching in home view
 */
function wireHomeCardClicks(): void {
  if (!homeStack) return;
  homeStack.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.project-card') as HTMLElement | null;
    if (!card) return;

    const index = homeTerminals.findIndex(t => t.container === card);
    if (index !== -1 && index !== homeActiveIndex) {
      switchToHomeTerminal(index);
    }
  });
}

/**
 * Switch to a specific terminal in the home stack
 */
function switchToHomeTerminal(index: number): void {
  if (index < 0 || index >= homeTerminals.length || index === homeActiveIndex) return;
  homeActiveIndex = index;
  updateHomeCardStack();
  requestAnimationFrame(() => {
    const term = homeTerminals[homeActiveIndex];
    if (term) {
      try { term.fitAddon.fit(); } catch { /* noop */ }
      term.terminal.focus();
    }
  });
}

/**
 * Select terminal by stack position (1-indexed, like Cmd+1-9)
 */
function selectByHomeStackPosition(position: number): void {
  if (homeTerminals.length === 0) return;

  const page = Math.floor(homeActiveIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, homeTerminals.length);
  const pageSize = pageEnd - pageStart;

  const backPositions: { index: number; diff: number }[] = [];
  for (let i = pageStart; i < pageEnd; i++) {
    if (i !== homeActiveIndex) {
      const diff = i < homeActiveIndex
        ? homeActiveIndex - i
        : pageSize - (i - pageStart) + (homeActiveIndex - pageStart);
      backPositions.push({ index: i, diff });
    }
  }
  backPositions.sort((a, b) => b.diff - a.diff);

  const arrayIndex = position - 1;
  if (arrayIndex >= 0 && arrayIndex < backPositions.length) {
    switchToHomeTerminal(backPositions[arrayIndex].index);
  }
}

/**
 * Close a terminal in the home view
 */
function closeHomeTerminal(index: number): void {
  if (index < 0 || index >= homeTerminals.length) return;

  const term = homeTerminals[index];
  const path = term.projectPath;

  // Kill PTY and clean up
  window.api.pty.kill(term.ptyId);
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

  // Remove from home list
  homeTerminals = homeTerminals.filter((_, i) => i !== index);

  // Remove from session
  const session = projectSessions.get(path);
  if (session) {
    session.terminals = session.terminals.filter(t => t !== term);
    if (session.terminals.length === 0) {
      session.stackElement.remove();
      projectSessions.delete(path);
      updateSidebarActiveState();
    }
  }

  if (homeTerminals.length === 0) {
    homeActiveIndex = 0;
    showHomeEmptyState();
    return;
  }

  // Adjust active index
  if (homeActiveIndex >= homeTerminals.length) {
    homeActiveIndex = homeTerminals.length - 1;
  } else if (index < homeActiveIndex) {
    homeActiveIndex--;
  }

  updateHomeCardStack();
  requestAnimationFrame(() => {
    const active = homeTerminals[homeActiveIndex];
    if (active) {
      try { active.fitAddon.fit(); } catch { /* noop */ }
      active.terminal.focus();
    }
  });
}

/**
 * Add a new terminal for a project from the home view
 */
async function addHomeTerminal(path: string): Promise<void> {
  homeLog.info('adding terminal from home view', { path });

  if (!homeStack) return;

  const label = 'shell';
  const card = createProjectCard(label, homeTerminals.length);
  convertIconsIn(card);

  const xtermContainer = card.querySelector('.terminal-xterm-container') as HTMLElement;
  const closeBtn = card.querySelector('.project-card-close') as HTMLButtonElement;

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

  // Remove empty state if showing
  homeStack.querySelector('.project-stack-empty')?.remove();
  homeStack.querySelector('.home-empty')?.remove();

  homeStack.appendChild(card);
  terminal.open(xtermContainer);
  setupTerminalAppHotkeys(terminal);

  await new Promise(resolve => requestAnimationFrame(resolve));
  fitAddon.fit();

  const spawnOptions: PtySpawnOptions = {
    cwd: path,
    projectPath: path,
    cols: terminal.cols,
    rows: terminal.rows,
    label,
  };

  try {
    const result = await window.api.pty.spawn(spawnOptions);
    if (!result.success || !result.ptyId) {
      terminal.writeln(`\x1b[31mFailed to start terminal: ${result.error || 'Unknown error'}\x1b[0m`);
      setTimeout(() => { card.remove(); terminal.dispose(); }, 5000);
      return;
    }

    const projectTerminal: ProjectTerminal = {
      ptyId: result.ptyId,
      projectPath: path,
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
      sandboxed: false,
      taskId: null,
      worktreePath: undefined,
      worktreeBranch: undefined,
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

    projectTerminal.resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (terminal.cols && terminal.rows) {
        window.api.pty.resize(result.ptyId!, terminal.cols, terminal.rows);
      }
    });
    projectTerminal.resizeObserver.observe(xtermContainer);

    projectTerminal.cleanupData = window.api.pty.onData(result.ptyId, (data) => {
      terminal.write(data);
    });

    projectTerminal.cleanupExit = window.api.pty.onExit(result.ptyId, (exitCode) => {
      terminal.writeln('');
      const exitColor = exitCode === 0 ? '32' : '31';
      terminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);
      projectTerminal.summary = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
      projectTerminal.summaryType = 'ready';
      updateTerminalCardLabel(projectTerminal);
    });

    terminal.onData((data) => {
      window.api.pty.write(result.ptyId!, data);
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = homeTerminals.indexOf(projectTerminal);
      if (idx !== -1) closeHomeTerminal(idx);
    });

    // Add to home list and session
    homeTerminals.push(projectTerminal);

    // Add to the project session (create one if needed)
    let session = projectSessions.get(path);
    if (session) {
      session.terminals.push(projectTerminal);
    }
    // If no session exists, we can't properly create one without a stackElement.
    // The terminal will still work in home view but won't transfer to project view.

    // Switch to the new terminal
    homeActiveIndex = homeTerminals.length - 1;
    updateHomeCardStack();
    terminal.focus();

    homeLog.info('terminal added from home view', { path, ptyId: result.ptyId });
  } catch (error) {
    homeLog.error('failed to spawn terminal from home view', { path, error: error instanceof Error ? error.message : String(error) });
    card.remove();
    terminal.dispose();
    showToast('Failed to start terminal', 'error');
  }
}

/**
 * Strip stack-specific positioning classes from a card element
 */
function stripStackClasses(card: HTMLElement): void {
  card.classList.remove(
    'project-card--active',
    'project-card--back-1',
    'project-card--back-2',
    'project-card--back-3',
    'project-card--back-4',
    'project-card--hidden',
  );
}

/**
 * Show empty state in the home stack
 */
function showHomeEmptyState(): void {
  if (!homeStack) return;
  const el = document.createElement('div');
  el.className = 'home-empty';
  el.innerHTML = `
    <i data-icon="terminal" class="home-empty-icon"></i>
    <h2 class="home-empty-title">No active terminals</h2>
    <p class="home-empty-description">Select a project from the sidebar to get started.</p>
  `;
  convertIconsIn(el);
  homeStack.appendChild(el);
}

/**
 * Register hook status listener for all terminals visible in home view
 */
function registerHomeHookStatusListener(): void {
  if (hookStatusCleanup) return;

  hookStatusCleanup = window.api.claudeHooks.onStatus((ptyId: PtyId, status: string) => {
    const term = homeTerminals.find(t => t.ptyId === ptyId);
    if (!term) return;

    const dot = term.container.querySelector('.project-card-status-dot') as HTMLElement;
    if (!dot) return;

    if (status === 'thinking') {
      dot.dataset.status = 'thinking';
      term.summaryType = 'thinking';
    } else {
      dot.dataset.status = 'ready';
      term.summaryType = 'ready';
    }
  });
}

/**
 * Unregister hook status listener for home view
 */
function unregisterHomeHookStatusListener(): void {
  if (hookStatusCleanup) {
    hookStatusCleanup();
    hookStatusCleanup = null;
  }
}
