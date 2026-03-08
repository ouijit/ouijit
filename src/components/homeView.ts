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
  orphanedSessions,
  ensureHiddenSessionsContainer,
  type ProjectTerminal,
} from './project/state';
import { homeViewActive, projectPath } from './project/signals';
import { exitProjectMode } from './project/projectMode';
import { getTerminalTheme, setupTerminalAppHotkeys, updateTerminalCardLabel, createProjectCard, debouncedResize, reconnectTerminal } from './project/terminalCards';
import { convertIconsIn } from '../utils/icons';
import { stringToColor } from '../utils/projectIcon';
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

// Folder divider elements (one per non-active project group)
let homeDividerElements: HTMLElement[] = [];

// Depth-ordered terminal indices (rebuilt each updateHomeCardStack call)
// Used by selectByHomeStackPosition for consistent Cmd+N mapping
let homeDepthOrder: number[] = [];

// Project data cache
let projectDataCache = new Map<string, Project>();

// Max back-card depth levels in home view (extended beyond project mode's 4)
const HOME_MAX_DEPTH = 8;

/**
 * Enter the home view, showing all terminals in a single card stack
 */
export async function enterHomeView(): Promise<void> {
  if (homeViewActive.value) return;

  if (projectPath.value !== null) {
    exitProjectMode();
  }

  homeLog.info('entering home view', { sessionCount: projectSessions.size, orphanedCount: orphanedSessions.size });

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

  // Reconnect any orphaned PTY sessions (from app restart) into projectSessions
  if (orphanedSessions.size > 0) {
    await reconnectOrphanedForHome();
  }

  // Build flat terminal list from all sessions, grouped by project
  homeTerminals = [];
  for (const [, session] of projectSessions) {
    for (const term of session.terminals) {
      homeTerminals.push(term);
      stripStackClasses(term.container);
      homeStack.appendChild(term.container);

      // Reconnect resize observer
      const xtermContainer = term.container.querySelector('.terminal-xterm-container');
      if (xtermContainer) {
        term.resizeObserver = new ResizeObserver(() => {
          debouncedResize(term.ptyId, term.terminal, term.fitAddon);
        });
        term.resizeObserver.observe(xtermContainer);
      }

      // Re-wire close button for home view context
      const closeBtn = term.container.querySelector('.project-card-close') as HTMLButtonElement;
      if (closeBtn) {
        const newBtn = closeBtn.cloneNode(true) as HTMLButtonElement;
        closeBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = homeTerminals.indexOf(term);
          if (idx !== -1) closeHomeTerminal(idx);
        });
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
  clearHomeDividers();
  homeStack?.remove();
  homeStack = null;
  homeTerminals = [];
  homeActiveIndex = 0;
  homeDepthOrder = [];

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
 * Update the home card stack with project-grouped depth ordering.
 * Active project's terminals are closest, then other projects each preceded by a folder divider.
 * Dividers are full card-like elements that consume a depth slot (transparent body, only tab visible).
 */
function updateHomeCardStack(): void {
  if (!homeStack) return;
  if (homeTerminals.length === 0) return;

  const activeTerminal = homeTerminals[homeActiveIndex];
  const activeProject = activeTerminal.projectPath;

  // Clear all positioning and dividers
  homeTerminals.forEach(term => stripStackClasses(term.container));
  clearHomeDividers();

  // Mark active
  activeTerminal.container.classList.add('project-card--active');

  // Group non-active terminals by project
  const sameProject: number[] = [];
  const otherProjectGroups = new Map<string, number[]>();

  homeTerminals.forEach((term, index) => {
    if (index === homeActiveIndex) return;
    if (term.projectPath === activeProject) {
      sameProject.push(index);
    } else {
      const group = otherProjectGroups.get(term.projectPath) || [];
      group.push(index);
      otherProjectGroups.set(term.projectPath, group);
    }
  });

  // Build combined depth list: same-project terminals, then [divider + terminals] per other project
  type StackItem = { type: 'terminal'; index: number } | { type: 'divider'; projectPath: string };
  const stackItems: StackItem[] = [];

  for (const idx of sameProject) {
    stackItems.push({ type: 'terminal', index: idx });
  }
  for (const [path, indices] of otherProjectGroups) {
    stackItems.push({ type: 'divider', projectPath: path });
    for (const idx of indices) {
      stackItems.push({ type: 'terminal', index: idx });
    }
  }

  // Assign depth levels and track terminal depth order for shortcuts
  homeDepthOrder = [];
  let maxUsedDepth = 0;

  for (let i = 0; i < stackItems.length; i++) {
    const depth = i + 1;
    const item = stackItems[i];

    if (depth > HOME_MAX_DEPTH) {
      if (item.type === 'terminal') {
        homeTerminals[item.index].container.classList.add('project-card--hidden');
      }
      continue;
    }

    maxUsedDepth = depth;

    if (item.type === 'terminal') {
      homeTerminals[item.index].container.classList.add(`project-card--back-${depth}`);
      homeDepthOrder.push(item.index);
    } else {
      const divider = createHomeFolderDivider(item.projectPath, depth);
      homeStack.appendChild(divider);
      homeDividerElements.push(divider);
    }
  }

  // Hide terminals not in the depth ordering and not active
  const visibleSet = new Set(homeDepthOrder);
  homeTerminals.forEach((term, index) => {
    if (index === homeActiveIndex || visibleSet.has(index)) return;
    if (!term.container.classList.contains('project-card--hidden')) {
      term.container.classList.add('project-card--hidden');
    }
  });

  // Stack top offset
  const tabSpace = maxUsedDepth * 24;
  homeStack.style.top = `${82 + tabSpace}px`;

  // Assign shortcut labels (⌘1 = deepest/topmost, descending toward active)
  const shortcutOrder = [...homeDepthOrder].reverse();

  homeTerminals.forEach((term, index) => {
    const shortcutEl = term.container.querySelector('.project-card-shortcut') as HTMLElement;
    const runnerBtn = term.container.querySelector('.card-tab-run') as HTMLElement;

    if (index === homeActiveIndex) {
      if (shortcutEl) shortcutEl.style.display = 'none';
      if (runnerBtn) runnerBtn.style.display = '';
    } else {
      const stackPosition = shortcutOrder.indexOf(index);
      if (shortcutEl) {
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
 * Create a folder divider element — a card-like element with transparent body,
 * only the tab is visible (project name + color dot).
 */
function createHomeFolderDivider(path: string, depth: number): HTMLElement {
  const project = projectDataCache.get(path);
  const name = project?.name || path.split('/').pop() || path;

  const divider = document.createElement('div');
  divider.className = `project-card home-folder-divider project-card--back-${depth}`;

  const label = document.createElement('div');
  label.className = 'project-card-label';
  label.innerHTML = `
    <div class="project-card-label-left">
      <div class="project-card-label-top">
        <span class="home-folder-dot" style="background: ${stringToColor(name)};"></span>
        <span class="home-folder-name">${name}</span>
      </div>
    </div>
  `;
  divider.appendChild(label);

  return divider;
}

/** Remove all folder divider elements from the stack */
function clearHomeDividers(): void {
  for (const el of homeDividerElements) el.remove();
  homeDividerElements = [];
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
 * Select terminal by stack position (1-indexed, like Cmd+1-9).
 * Uses the project-grouped depth ordering (⌘1 = topmost/deepest).
 */
function selectByHomeStackPosition(position: number): void {
  if (homeTerminals.length === 0 || homeDepthOrder.length === 0) return;

  // Visible terminals in shortcut order (deepest first)
  const shortcutOrder = [...homeDepthOrder].reverse();

  const arrayIndex = position - 1;
  if (arrayIndex >= 0 && arrayIndex < shortcutOrder.length) {
    switchToHomeTerminal(shortcutOrder[arrayIndex]);
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
 * Reconnect orphaned PTY sessions (from app restart) and store them in projectSessions
 * so the main enterHomeView loop can pick them up.
 */
async function reconnectOrphanedForHome(): Promise<void> {
  homeLog.info('reconnecting orphaned sessions for home view', { count: orphanedSessions.size });

  // Tell main process we're ready to receive PTY data
  window.api.pty.setWindow();

  for (const [path, sessions] of orphanedSessions) {
    const mainSessions = sessions.filter(s => !s.isRunner);

    // Create a hidden stack element to store these terminals for later project-mode use
    const stackElement = document.createElement('div');
    stackElement.className = 'project-stack';

    const reconnectedTerminals: ProjectTerminal[] = [];

    for (const session of mainSessions) {
      const pt = await reconnectSingleTerminal(session, stackElement);
      if (pt) reconnectedTerminals.push(pt);
    }

    if (reconnectedTerminals.length > 0) {
      const project = projectDataCache.get(path) || {
        name: path.split('/').pop() || path,
        path,
        hasGit: false,
      } as Project;

      projectSessions.set(path, {
        terminals: reconnectedTerminals,
        activeIndex: 0,
        projectData: project,
        stackElement,
        kanbanWasVisible: true,
        diffPanelWasOpen: false,
        diffSelectedFile: null,
        diffFiles: [],
      });
    }
  }

  orphanedSessions.clear();
  updateSidebarActiveState();
}

/**
 * Reconnect a single orphaned PTY session using the shared reconnectTerminal utility.
 * Wires a home-view-appropriate exit handler (show exit message rather than auto-close).
 */
async function reconnectSingleTerminal(
  session: import('../types').ActiveSession,
  stackElement: HTMLElement
): Promise<ProjectTerminal | null> {
  const pt = await reconnectTerminal(session, stackElement);
  if (!pt) {
    homeLog.error('failed to reconnect orphaned PTY', { ptyId: session.ptyId });
    return null;
  }

  // Wire home-view exit handler (display exit message instead of auto-close)
  pt.cleanupExit = window.api.pty.onExit(session.ptyId, (exitCode) => {
    pt.terminal.writeln('');
    const exitColor = exitCode === 0 ? '32' : '31';
    pt.terminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);
    pt.summary = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
    pt.summaryType = 'ready';
    updateTerminalCardLabel(pt);
  });

  homeLog.info('reconnected orphaned terminal', { ptyId: session.ptyId, projectPath: session.projectPath });
  return pt;
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
    'project-card--back-5',
    'project-card--back-6',
    'project-card--back-7',
    'project-card--back-8',
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
