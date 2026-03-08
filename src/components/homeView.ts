/**
 * Home view — cross-project terminal multiplexer
 * Shows all active terminals grouped by project
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
  type StoredProjectSession,
} from './project/state';
import { homeViewActive, projectPath } from './project/signals';
import { exitProjectMode } from './project/projectMode';
import { getTerminalTheme, setupTerminalAppHotkeys, updateTerminalCardLabel, createProjectCard } from './project/terminalCards';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { convertIconsIn } from '../utils/icons';
import { Scopes, pushScope, popScope, registerHotkey, unregisterHotkey, platformHotkey } from '../utils/hotkeys';
import { showToast } from './importDialog';
import { updateSidebarActiveState } from './sidebar';

const homeLog = log.scope('homeView');

// Track which terminal is focused in home view
let focusedTerminal: ProjectTerminal | null = null;

// Hook status cleanup
let hookStatusCleanup: (() => void) | null = null;

// Track home view container
let homeContainer: HTMLElement | null = null;

// Project data cache (populated from sidebar or API)
let projectDataCache = new Map<string, Project>();

/**
 * Enter the home view, showing all terminals across all projects
 */
export async function enterHomeView(): Promise<void> {
  // Guard: already in home view
  if (homeViewActive.value) return;

  // If in project mode, exit first (preserves sessions)
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

  // Create home view container
  const mainContent = document.querySelector('.main-content');
  if (!mainContent) return;

  homeContainer = document.createElement('div');
  homeContainer.className = 'home-view';

  // Populate project data cache
  try {
    const projects = await window.api.getProjects();
    projectDataCache = new Map(projects.map(p => [p.path, p]));
  } catch {
    // Fall back to data from sessions
  }

  // Render terminal groups from preserved sessions
  let hasTerminals = false;
  for (const [path, session] of projectSessions) {
    if (session.terminals.length === 0) continue;
    hasTerminals = true;
    const project = projectDataCache.get(path) || session.projectData;
    const group = createProjectGroup(path, project, session);
    homeContainer.appendChild(group);
  }

  if (!hasTerminals) {
    homeContainer.appendChild(createEmptyState());
  }

  mainContent.appendChild(homeContainer);

  // Fit all terminals after they're in the DOM
  requestAnimationFrame(() => {
    for (const [, session] of projectSessions) {
      for (const term of session.terminals) {
        try {
          term.fitAddon.fit();
        } catch {
          // Terminal may not be attached yet
        }
      }
    }
  });

  // Register hotkeys
  pushScope(Scopes.HOME);
  registerHotkey(platformHotkey('mod+w'), Scopes.HOME, () => {
    if (focusedTerminal) {
      closeHomeTerminal(focusedTerminal);
    }
  });

  // Register hook status listener for all terminals in home view
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
  for (const [path, session] of projectSessions) {
    const group = homeContainer?.querySelector(`[data-project-path="${CSS.escape(path)}"]`);
    if (!group) continue;

    const terminalsContainer = group.querySelector('.home-group-terminals');
    if (!terminalsContainer) continue;

    // Move cards back to the stored stack element
    const cards = terminalsContainer.querySelectorAll('.project-card');
    for (const card of cards) {
      session.stackElement.appendChild(card);
    }

    // Disconnect resize observers while hidden
    for (const term of session.terminals) {
      if (term.resizeObserver) {
        term.resizeObserver.disconnect();
      }
    }

    // Move stack back to hidden container
    const hiddenContainer = ensureHiddenSessionsContainer();
    hiddenContainer.appendChild(session.stackElement);
  }

  // Clean up
  homeContainer?.remove();
  homeContainer = null;
  focusedTerminal = null;

  document.body.classList.remove('home-mode');
  homeViewActive.value = false;

  // Unregister hotkeys
  unregisterHotkey(platformHotkey('mod+w'), Scopes.HOME);
  popScope();

  // Unregister hook status listener
  unregisterHomeHookStatusListener();
}

/**
 * Create a project group element with header and terminal cards
 */
function createProjectGroup(path: string, project: Project, session: StoredProjectSession): HTMLElement {
  const group = document.createElement('div');
  group.className = 'home-group';
  group.dataset.projectPath = path;

  // Group header
  const header = document.createElement('div');
  header.className = 'home-group-header';

  // Project icon
  const iconEl = document.createElement('div');
  iconEl.className = 'home-group-icon';
  if (project.iconDataUrl) {
    const img = document.createElement('img');
    img.src = project.iconDataUrl;
    img.alt = project.name;
    img.className = 'home-group-icon-image';
    img.draggable = false;
    iconEl.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'home-group-icon-placeholder';
    placeholder.style.backgroundColor = stringToColor(project.name);
    placeholder.textContent = getInitials(project.name);
    iconEl.appendChild(placeholder);
  }
  header.appendChild(iconEl);

  // Project name
  const nameEl = document.createElement('span');
  nameEl.className = 'home-group-name';
  nameEl.textContent = project.name;
  header.appendChild(nameEl);

  // Terminal count
  const countEl = document.createElement('span');
  countEl.className = 'home-group-count';
  countEl.textContent = `${session.terminals.length}`;
  header.appendChild(countEl);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'home-group-actions';

  const addBtn = document.createElement('button');
  addBtn.className = 'home-group-btn';
  addBtn.title = 'New terminal';
  addBtn.innerHTML = '<i data-icon="plus"></i>';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addHomeTerminal(path, project);
  });
  actions.appendChild(addBtn);

  const navBtn = document.createElement('button');
  navBtn.className = 'home-group-btn';
  navBtn.title = 'Open project';
  navBtn.innerHTML = '<i data-icon="arrow-right"></i>';
  navBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateToProject(path);
  });
  actions.appendChild(navBtn);

  header.appendChild(actions);
  convertIconsIn(header);
  group.appendChild(header);

  // Terminal cards container
  const terminalsEl = document.createElement('div');
  terminalsEl.className = 'home-group-terminals';

  // Extract cards from the stored stack element and append here
  for (const term of session.terminals) {
    // Strip stack-specific classes so home view CSS overrides apply cleanly
    stripStackClasses(term.container);
    terminalsEl.appendChild(term.container);

    // Reconnect resize observer
    if (term.resizeObserver) {
      const xtermContainer = term.container.querySelector('.terminal-xterm-container');
      if (xtermContainer) {
        term.resizeObserver.observe(xtermContainer);
      }
    }

    // Wire click-to-focus
    wireCardFocus(term);
  }

  group.appendChild(terminalsEl);
  return group;
}

/**
 * Strip stack-specific positioning classes from a card element
 * so home view CSS overrides apply cleanly
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
 * Wire click-to-focus behavior on a terminal card in home view
 */
function wireCardFocus(term: ProjectTerminal): void {
  const handler = () => {
    focusedTerminal = term;
    term.terminal.focus();
  };
  // Use mousedown so focus happens before xterm captures the click
  term.container.addEventListener('mousedown', handler, { capture: true });
}

/**
 * Navigate from home view to a specific project
 */
function navigateToProject(path: string): void {
  // This will be wired by the renderer — dispatch a custom event
  const event = new CustomEvent('home-navigate-project', { detail: { path } });
  document.dispatchEvent(event);
}

/**
 * Add a new terminal for a project from the home view
 */
async function addHomeTerminal(path: string, project: Project): Promise<void> {
  homeLog.info('adding terminal from home view', { path });

  // Create a card element
  const session = projectSessions.get(path);
  if (!session) {
    homeLog.error('no session found for project', { path });
    return;
  }

  const index = session.terminals.length;
  const label = 'shell';
  const card = createProjectCard(label, index);
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

  // Add card to the group's terminals container
  const group = homeContainer?.querySelector(`[data-project-path="${CSS.escape(path)}"]`);
  const terminalsEl = group?.querySelector('.home-group-terminals');
  if (terminalsEl) {
    terminalsEl.appendChild(card);
  }

  terminal.open(xtermContainer);
  setupTerminalAppHotkeys(terminal);

  await new Promise(resolve => requestAnimationFrame(resolve));
  fitAddon.fit();

  // Spawn PTY
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
      setTimeout(() => {
        card.remove();
        terminal.dispose();
      }, 5000);
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

    // Resize observer
    projectTerminal.resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (terminal.cols && terminal.rows) {
        window.api.pty.resize(result.ptyId!, terminal.cols, terminal.rows);
      }
    });
    projectTerminal.resizeObserver.observe(xtermContainer);

    // Data listener
    projectTerminal.cleanupData = window.api.pty.onData(result.ptyId, (data) => {
      terminal.write(data);
    });

    // Exit listener
    projectTerminal.cleanupExit = window.api.pty.onExit(result.ptyId, (exitCode) => {
      terminal.writeln('');
      const exitColor = exitCode === 0 ? '32' : '31';
      terminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);
      projectTerminal.summary = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
      projectTerminal.summaryType = 'ready';
      updateTerminalCardLabel(projectTerminal);
    });

    // Forward input
    terminal.onData((data) => {
      window.api.pty.write(result.ptyId!, data);
    });

    // Close button
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeHomeTerminal(projectTerminal);
    });

    // Click to focus
    wireCardFocus(projectTerminal);

    // Add to session
    session.terminals.push(projectTerminal);

    // Update count
    updateGroupCount(path);

    // Focus the new terminal
    focusedTerminal = projectTerminal;
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
 * Close a terminal in the home view
 */
function closeHomeTerminal(term: ProjectTerminal): void {
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

  // Remove from session
  const session = projectSessions.get(path);
  if (session) {
    session.terminals = session.terminals.filter(t => t !== term);
    updateGroupCount(path);

    // If no terminals left in this group, remove the group and session
    if (session.terminals.length === 0) {
      const group = homeContainer?.querySelector(`[data-project-path="${CSS.escape(path)}"]`);
      group?.remove();
      session.stackElement.remove();
      projectSessions.delete(path);
      updateSidebarActiveState();

      // If no groups left, show empty state
      if (projectSessions.size === 0 || !hasAnyTerminals()) {
        const existing = homeContainer?.querySelector('.home-empty');
        if (!existing && homeContainer) {
          homeContainer.appendChild(createEmptyState());
        }
      }
    }
  }

  if (focusedTerminal === term) {
    focusedTerminal = null;
  }
}

/**
 * Update the terminal count badge for a project group
 */
function updateGroupCount(path: string): void {
  const group = homeContainer?.querySelector(`[data-project-path="${CSS.escape(path)}"]`);
  const countEl = group?.querySelector('.home-group-count');
  const session = projectSessions.get(path);
  if (countEl && session) {
    countEl.textContent = `${session.terminals.length}`;
  }
}

/**
 * Check if there are any terminals across all sessions
 */
function hasAnyTerminals(): boolean {
  for (const [, session] of projectSessions) {
    if (session.terminals.length > 0) return true;
  }
  return false;
}

/**
 * Create the empty state element for home view
 */
function createEmptyState(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'home-empty';
  el.innerHTML = `
    <i data-icon="terminal" class="home-empty-icon"></i>
    <h2 class="home-empty-title">No active terminals</h2>
    <p class="home-empty-description">Select a project from the sidebar to get started.</p>
  `;
  convertIconsIn(el);
  return el;
}

/**
 * Register hook status listener for all terminals visible in home view
 */
function registerHomeHookStatusListener(): void {
  if (hookStatusCleanup) return;

  hookStatusCleanup = window.api.claudeHooks.onStatus((ptyId: PtyId, status: string) => {
    // Find the terminal across all sessions
    for (const [, session] of projectSessions) {
      const term = session.terminals.find(t => t.ptyId === ptyId);
      if (!term) continue;

      const dot = term.container.querySelector('.project-card-status-dot') as HTMLElement;
      if (!dot) return;

      if (status === 'thinking') {
        dot.dataset.status = 'thinking';
        term.summaryType = 'thinking';
      } else {
        dot.dataset.status = 'ready';
        term.summaryType = 'ready';
      }
      break;
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
