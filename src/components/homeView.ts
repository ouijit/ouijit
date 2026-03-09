/**
 * Home view — cross-project terminal multiplexer
 * Shows all active terminals in a single card stack, organized by project
 */

import log from 'electron-log/renderer';
import type { Project, PtySpawnOptions } from '../types';
import { homeViewActive, projectPath } from './project/signals';
import { ensureHiddenSessionsContainer } from './project/state';
import { exitProjectMode } from './project/projectMode';
import { OuijitTerminal, scrollSafeFit, resolveTerminalLabel } from './project/terminal';
import { getManager } from './project/terminalManager';
import { setupCardActions, reconnectTerminal, collapseTagInput } from './project/terminalCards';
import { convertIconsIn } from '../utils/icons';
import { escapeHtml } from '../utils/html';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { Scopes, pushScope, popScope, registerHotkey, unregisterHotkey, platformHotkey } from '../utils/hotkeys';
import { showToast } from './importDialog';
import { showNewProjectDialog } from './newProjectDialog';
import { convertTitlesIn } from '../utils/tooltip';
import { updateSidebarActiveState } from './sidebar';

const homeLog = log.scope('homeView');

// Platform detection for shortcut display
const isMac = navigator.platform.toLowerCase().includes('mac');

// Flat list of all terminals displayed in the home view stack
let homeTerminals: OuijitTerminal[] = [];
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

// Grouping mode for home view: by project or by tag
type HomeGroupMode = 'project' | 'tag';
let homeGroupMode: HomeGroupMode = 'project';

// Stack item union for depth ordering
type StackItem =
  | { type: 'terminal'; index: number }
  | { type: 'project-divider'; projectPath: string }
  | { type: 'tag-divider'; tagName: string };

// Project data cache
let projectDataCache = new Map<string, Project>();

// Max depth level with a predefined CSS class (back-1 through back-8)
const CSS_MAX_DEPTH = 8;

/**
 * Enter the home view, showing all terminals in a single card stack
 */
export async function enterHomeView(): Promise<void> {
  if (homeViewActive.value) return;

  if (projectPath.value !== null) {
    exitProjectMode();
  }

  const manager = getManager();

  homeLog.info('entering home view', { sessionCount: manager.sessions.size, orphanedCount: manager.orphanedSessions.size });

  // Persist last active view for session recovery
  window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'home' }));

  homeViewActive.value = true;
  document.body.classList.add('home-mode');

  // Set up home header with grouping toggle
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    headerContent.innerHTML = `<div class="project-header-content">
      <span class="home-header-label">Sessions</span>
      <div style="flex: 1;"></div>
      <div class="project-view-toggle">
        <button class="project-view-toggle-btn${homeGroupMode === 'project' ? ' project-view-toggle-btn--active' : ''}" data-mode="project" title="Group by project">
          <i data-icon="folder-open"></i>
        </button>
        <button class="project-view-toggle-btn${homeGroupMode === 'tag' ? ' project-view-toggle-btn--active' : ''}" data-mode="tag" title="Group by tag">
          <i data-icon="tag"></i>
        </button>
      </div>
      <button class="project-terminal-btn home-new-terminal-btn" title="New terminal">
        <i data-icon="terminal"></i>
      </button>
    </div>`;
    convertIconsIn(headerContent);
    convertTitlesIn(headerContent, 'bottom');

    // Wire new terminal button
    const newTermBtn = headerContent.querySelector('.home-new-terminal-btn');
    if (newTermBtn) {
      newTermBtn.addEventListener('click', async () => {
        try {
          const homePath = await window.api.homePath();
          await addHomeTerminal(homePath);
        } catch (err) {
          homeLog.error('failed to open new terminal', { error: err instanceof Error ? err.message : String(err) });
        }
      });
    }

    // Wire toggle clicks
    headerContent.querySelectorAll('.project-view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as HomeGroupMode;
        if (mode !== homeGroupMode) toggleHomeGroupMode(mode);
      });
    });
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

  // Reconnect any orphaned PTY sessions (from app restart) into sessions
  if (manager.orphanedSessions.size > 0) {
    await reconnectOrphanedForHome();
  }

  // Build flat terminal list from all sessions, grouped by project
  homeTerminals = [];
  for (const [, session] of manager.sessions) {
    for (const term of session.terminals) {
      homeTerminals.push(term);
      stripStackClasses(term.container);
      homeStack.appendChild(term.container);

      // Reattach terminal (reconnects resize observers)
      term.reattach();

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
        try { scrollSafeFit(active.xterm, active.fitAddon); } catch { /* noop */ }
        active.xterm.focus();
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
  registerHotkey(platformHotkey('mod+t'), Scopes.HOME, () => {
    toggleHomeGroupMode(homeGroupMode === 'project' ? 'tag' : 'project');
  });
  registerHotkey(platformHotkey('mod+i'), Scopes.HOME, async () => {
    try {
      const homePath = await window.api.homePath();
      await addHomeTerminal(homePath);
    } catch (err) {
      homeLog.error('failed to open new terminal', { error: err instanceof Error ? err.message : String(err) });
    }
  });
  for (let i = 1; i <= 9; i++) {
    registerHotkey(platformHotkey(`mod+${i}`), Scopes.HOME, () => {
      selectByHomeStackPosition(i);
    });
  }

  // Register hook status listener
  registerHomeHookStatusListener();

  // Seed hook status from main process so dots reflect current state
  // (background terminals may have transitioned while viewing a project)
  seedHomeHookStatus();

  updateSidebarActiveState();
}

/**
 * Exit the home view, returning terminals to hidden session containers
 */
export function exitHomeView(): void {
  if (!homeViewActive.value) return;

  homeLog.info('exiting home view');

  const manager = getManager();

  // Return all terminal cards to their stored stack elements
  for (const [, session] of manager.sessions) {
    for (const term of session.terminals) {
      stripStackClasses(term.container);
      session.stackElement.appendChild(term.container);
      // Detach to disconnect resize observers while hidden
      term.detach();
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
  unregisterHotkey(platformHotkey('mod+t'), Scopes.HOME);
  unregisterHotkey(platformHotkey('mod+i'), Scopes.HOME);
  for (let i = 1; i <= 9; i++) {
    unregisterHotkey(platformHotkey(`mod+${i}`), Scopes.HOME);
  }
  popScope();

  unregisterHomeHookStatusListener();
}


/** Toggle home grouping mode and update UI */
function toggleHomeGroupMode(mode: HomeGroupMode): void {
  homeGroupMode = mode;
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    headerContent.querySelectorAll('.project-view-toggle-btn').forEach(b =>
      b.classList.toggle('project-view-toggle-btn--active', (b as HTMLElement).dataset.mode === mode)
    );
  }
  updateHomeCardStack();
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

  // Clear all positioning and dividers
  homeTerminals.forEach(term => stripStackClasses(term.container));
  clearHomeDividers();

  // Mark active
  activeTerminal.container.classList.add('project-card--active');

  // Build stack items based on grouping mode
  const stackItems = homeGroupMode === 'tag'
    ? buildTagGroupedStack(activeTerminal)
    : buildProjectGroupedStack(activeTerminal);

  // Assign depth levels and track terminal depth order for shortcuts
  homeDepthOrder = [];
  let maxUsedDepth = 0;

  for (let i = 0; i < stackItems.length; i++) {
    const depth = i + 1;
    const item = stackItems[i];

    maxUsedDepth = depth;

    if (item.type === 'terminal') {
      applyDepthStyle(homeTerminals[item.index].container, depth);
      homeDepthOrder.push(item.index);
    } else if (item.type === 'project-divider') {
      const divider = createHomeFolderDivider(item.projectPath, depth);
      homeStack.appendChild(divider);
      homeDividerElements.push(divider);
    } else {
      const divider = createHomeTagDivider(item.tagName, depth);
      homeStack.appendChild(divider);
      homeDividerElements.push(divider);
    }
  }

  // Sync tag visibility class for all terminals
  homeTerminals.forEach(term => {
    term.container.classList.toggle('project-card--has-tags', term.tags.value.length > 0);
  });

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
      if (runnerBtn) runnerBtn.style.display = term.taskId != null ? '' : 'none';
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

/** Build stack items grouped by project (default mode) */
function buildProjectGroupedStack(activeTerminal: OuijitTerminal): StackItem[] {
  const activeProject = activeTerminal.projectPath;
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

  const items: StackItem[] = [];

  // Active group — always emit divider even if only the active terminal is in it
  for (const idx of sameProject) {
    items.push({ type: 'terminal', index: idx });
  }
  items.push({ type: 'project-divider', projectPath: activeProject });

  for (const [path, indices] of otherProjectGroups) {
    for (const idx of indices) {
      items.push({ type: 'terminal', index: idx });
    }
    items.push({ type: 'project-divider', projectPath: path });
  }

  return items;
}

/** Build stack items grouped by tag */
function buildTagGroupedStack(activeTerminal: OuijitTerminal): StackItem[] {
  const activeTag = activeTerminal.tags.value.length > 0 ? activeTerminal.tags.value[0].toLowerCase() : null;

  const sameGroup: number[] = [];
  const tagGroups = new Map<string, { displayName: string; indices: number[] }>();
  const untagged: number[] = [];

  homeTerminals.forEach((term, index) => {
    if (index === homeActiveIndex) return;
    const firstTag = term.tags.value.length > 0 ? term.tags.value[0] : null;
    const firstTagLower = firstTag?.toLowerCase() ?? null;

    if (firstTagLower === activeTag) {
      sameGroup.push(index);
    } else if (firstTag === null) {
      untagged.push(index);
    } else {
      let group = tagGroups.get(firstTagLower!);
      if (!group) {
        group = { displayName: firstTag!, indices: [] };
        tagGroups.set(firstTagLower!, group);
      }
      group.indices.push(index);
    }
  });

  const items: StackItem[] = [];

  if (activeTag) {
    // Active terminal is tagged: same tag closest, other tags next, untagged at back
    // Always emit divider for active group so stack depth stays consistent
    for (const idx of sameGroup) {
      items.push({ type: 'terminal', index: idx });
    }
    items.push({ type: 'tag-divider', tagName: activeTerminal.tags.value[0] });

    for (const [, group] of tagGroups) {
      for (const idx of group.indices) {
        items.push({ type: 'terminal', index: idx });
      }
      items.push({ type: 'tag-divider', tagName: group.displayName });
    }

    if (untagged.length > 0) {
      for (const idx of untagged) {
        items.push({ type: 'terminal', index: idx });
      }
      items.push({ type: 'tag-divider', tagName: 'Untagged' });
    }
  } else {
    // Active terminal is untagged: untagged group closest, tag groups at back
    for (const idx of sameGroup) {
      items.push({ type: 'terminal', index: idx });
    }
    items.push({ type: 'tag-divider', tagName: 'Untagged' });

    for (const [, group] of tagGroups) {
      for (const idx of group.indices) {
        items.push({ type: 'terminal', index: idx });
      }
      items.push({ type: 'tag-divider', tagName: group.displayName });
    }
  }

  return items;
}

/** Shared SVG tab shape for home dividers */
const DIVIDER_TAB_SVG = `
  <svg viewBox="0 0 234 28" width="234" height="28">
    <path d="M 14 0.5 H 205.5 Q 219.5 0.5 219.5 14.5 L 219.5 13.5 Q 219.5 27.5 233.5 27.5 L 0.5 27.5 L 0.5 14 Q 0.5 0.5 14 0.5 Z"
          fill="#252528"/>
    <path d="M 0.5 27.5 L 0.5 14 Q 0.5 0.5 14 0.5 H 205.5 Q 219.5 0.5 219.5 14.5 L 219.5 13.5 Q 219.5 27.5 233.5 27.5"
          fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
  </svg>`;

/**
 * Create a home divider element — a card-like element with transparent body,
 * only the tab is visible. Used for both project and tag grouping.
 */
function createHomeDivider(iconHtml: string, label: string, depth: number, dataset: Record<string, string>): HTMLElement {
  const divider = document.createElement('div');
  divider.className = 'project-card home-folder-divider';
  Object.assign(divider.dataset, dataset);
  applyDepthStyle(divider, depth);

  const tab = document.createElement('div');
  tab.className = 'home-folder-tab';
  tab.innerHTML = `${DIVIDER_TAB_SVG}
    <div class="home-folder-tab-content">
      ${iconHtml}
      <span class="home-folder-name">${escapeHtml(label)}</span>
    </div>`;
  divider.appendChild(tab);
  convertIconsIn(divider);

  return divider;
}

function createHomeFolderDivider(path: string, depth: number): HTMLElement {
  const project = projectDataCache.get(path);
  const name = project?.name || 'shell';

  let iconHtml: string;
  if (project?.iconDataUrl) {
    iconHtml = `<img class="home-folder-icon" src="${project.iconDataUrl}" alt="${escapeHtml(name)}" draggable="false">`;
  } else if (project) {
    iconHtml = `<span class="home-folder-icon home-folder-icon-placeholder" style="background-color: ${stringToColor(name)}">${escapeHtml(getInitials(name))}</span>`;
  } else {
    iconHtml = `<i data-icon="terminal" class="home-folder-icon home-folder-shell-icon"></i>`;
  }

  return createHomeDivider(iconHtml, name, depth, { dividerProject: path });
}

function createHomeTagDivider(tagName: string, depth: number): HTMLElement {
  return createHomeDivider(
    `<i data-icon="tag" class="home-tag-icon"></i>`,
    tagName, depth, { dividerTag: tagName },
  );
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

    // Terminal card click
    const index = homeTerminals.findIndex(t => t.container === card);
    if (index !== -1 && index !== homeActiveIndex) {
      switchToHomeTerminal(index);
      return;
    }

    // Divider click — bring that group to front
    if (card.classList.contains('home-folder-divider')) {
      const tagGroup = card.dataset.dividerTag;
      const projectGroup = card.dataset.dividerProject;
      let target = -1;

      if (tagGroup !== undefined) {
        target = tagGroup === 'Untagged'
          ? homeTerminals.findIndex(t => t.tags.value.length === 0)
          : homeTerminals.findIndex(t => t.tags.value.length > 0 && t.tags.value[0].toLowerCase() === tagGroup.toLowerCase());
      } else if (projectGroup) {
        target = homeTerminals.findIndex(t => t.projectPath === projectGroup);
      }

      if (target !== -1 && target !== homeActiveIndex) {
        switchToHomeTerminal(target);
      }
    }
  });
}

/**
 * Switch to a specific terminal in the home stack
 */
function switchToHomeTerminal(index: number): void {
  if (index < 0 || index >= homeTerminals.length || index === homeActiveIndex) return;
  const prev = homeTerminals[homeActiveIndex];
  if (prev) collapseTagInput(prev);
  homeActiveIndex = index;
  updateHomeCardStack();
  requestAnimationFrame(() => {
    const term = homeTerminals[homeActiveIndex];
    if (term) {
      try { scrollSafeFit(term.xterm, term.fitAddon); } catch { /* noop */ }
      term.xterm.focus();
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

  // Collapse tag input to clean up click-outside listener
  collapseTagInput(term);

  // Dispose terminal (kills PTY, removes DOM, cleans up runner)
  term.dispose();

  // Remove from home list
  homeTerminals = homeTerminals.filter((_, i) => i !== index);

  // Remove from session
  const manager = getManager();
  const session = manager.sessions.get(path);
  if (session) {
    session.terminals = session.terminals.filter(t => t !== term);
    if (session.terminals.length === 0) {
      session.stackElement.remove();
      manager.sessions.delete(path);
      updateSidebarActiveState();
    }
  }

  if (homeTerminals.length === 0) {
    homeActiveIndex = 0;
    clearHomeDividers();
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
      try { scrollSafeFit(active.xterm, active.fitAddon); } catch { /* noop */ }
      active.xterm.focus();
    }
  });
}

/**
 * Add a new terminal for a project from the home view
 */
/** Options for adding a terminal in home view with worktree/task context */
export interface HomeTerminalOptions {
  worktreePath?: string;
  worktreeBranch?: string;
  taskId?: number;
  sandboxed?: boolean;
}

async function addHomeTerminal(path: string, opts?: HomeTerminalOptions): Promise<void> {
  homeLog.info('adding terminal from home view', { path, opts });

  if (!homeStack) return;

  // Remove empty state if showing
  homeStack.querySelector('.project-stack-empty')?.remove();

  const cwd = opts?.worktreePath || path;
  let label = 'shell';
  if (opts?.taskId != null) {
    const task = await window.api.task.getByNumber(path, opts.taskId);
    label = resolveTerminalLabel(task?.name, opts?.worktreeBranch);
  }

  const term = new OuijitTerminal({
    projectPath: path,
    label,
    taskId: opts?.taskId ?? null,
    worktreePath: opts?.worktreePath,
    worktreeBranch: opts?.worktreeBranch,
    sandboxed: opts?.sandboxed,
  });

  homeStack.appendChild(term.container);
  term.openTerminal();

  await new Promise(resolve => requestAnimationFrame(resolve));
  term.fitAddon.fit();

  // Resolve start command from hooks for worktree terminals
  let startCommand: string | undefined;
  let startEnv: Record<string, string> | undefined;
  if (opts?.worktreePath && opts?.worktreeBranch) {
    startEnv = {
      OUIJIT_HOOK_TYPE: 'continue',
      OUIJIT_PROJECT_PATH: path,
      OUIJIT_WORKTREE_PATH: opts.worktreePath,
      OUIJIT_TASK_BRANCH: opts.worktreeBranch,
      OUIJIT_TASK_NAME: label,
    };
    try {
      const hooks = await window.api.hooks.get(path);
      if (hooks.continue) startCommand = hooks.continue.command;
    } catch { /* no hooks */ }
  }

  const spawnOptions: PtySpawnOptions = {
    cwd,
    projectPath: path,
    command: startCommand,
    cols: term.xterm.cols,
    rows: term.xterm.rows,
    label,
    taskId: opts?.taskId,
    worktreePath: opts?.worktreePath,
    env: startEnv,
    sandboxed: opts?.sandboxed,
  };

  try {
    const result = await window.api.pty.spawn(spawnOptions);
    if (!result.success || !result.ptyId) {
      term.xterm.writeln(`\x1b[31mFailed to start terminal: ${result.error || 'Unknown error'}\x1b[0m`);
      setTimeout(() => { term.container.remove(); term.xterm.dispose(); }, 5000);
      return;
    }

    // Bind to PTY (wires data, exit, input, resize)
    term.bind(result.ptyId);

    // Wire tag button and other card actions
    setupCardActions(term);

    // Wire close button for home view context
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

    // Add to home list and session
    homeTerminals.push(term);

    // Add to the project session (create one if needed for persistence across view switches)
    // Note: don't move the card to stackElement here — it's already in homeStack.
    // exitHomeView handles moving cards to their session stackElements.
    const manager = getManager();
    let session = manager.sessions.get(path);
    if (session) {
      session.terminals.push(term);
    } else {
      const hiddenContainer = ensureHiddenSessionsContainer();
      const stackElement = document.createElement('div');
      stackElement.className = 'project-stack';
      hiddenContainer.appendChild(stackElement);

      manager.sessions.set(path, {
        terminals: [term],
        activeIndex: 0,
        projectData: { name: 'shell', path, hasGit: false, hasClaude: false, lastModified: new Date() },
        stackElement,
        kanbanWasVisible: false,
        diffPanelWasOpen: false,
        diffSelectedFile: null,
        diffFiles: [],
      });
    }

    // Fetch git status and tags for task terminals
    term.refreshGitStatus();
    term.loadTags();

    // Switch to the new terminal
    homeActiveIndex = homeTerminals.length - 1;
    updateHomeCardStack();
    term.xterm.focus();

    homeLog.info('terminal added from home view', { path, ptyId: result.ptyId });
  } catch (error) {
    homeLog.error('failed to spawn terminal from home view', { path, error: error instanceof Error ? error.message : String(error) });
    term.container.remove();
    term.xterm.dispose();
    showToast('Failed to start terminal', 'error');
  }
}

/** Public entry point for adding a terminal from outside homeView (e.g. context menus) */
export async function addTerminalInHomeView(path: string, opts?: HomeTerminalOptions): Promise<void> {
  return addHomeTerminal(path, opts);
}

/**
 * Reconnect orphaned PTY sessions (from app restart) and store them in sessions
 * so the main enterHomeView loop can pick them up.
 */
async function reconnectOrphanedForHome(): Promise<void> {
  const manager = getManager();
  homeLog.info('reconnecting orphaned sessions for home view', { count: manager.orphanedSessions.size });

  // Tell main process we're ready to receive PTY data
  window.api.pty.setWindow();

  for (const [path, sessions] of manager.orphanedSessions) {
    const mainSessions = sessions.filter(s => !s.isRunner);

    // Create a hidden stack element to store these terminals for later project-mode use
    const stackElement = document.createElement('div');
    stackElement.className = 'project-stack';

    const reconnectedTerminals: OuijitTerminal[] = [];

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

      manager.sessions.set(path, {
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

  manager.orphanedSessions.clear();
  updateSidebarActiveState();
}

/**
 * Reconnect a single orphaned PTY session using the shared reconnectTerminal utility.
 * Wires a home-view-appropriate exit handler (show exit message rather than auto-close).
 */
async function reconnectSingleTerminal(
  session: import('../types').ActiveSession,
  stackElement: HTMLElement
): Promise<OuijitTerminal | null> {
  const pt = await reconnectTerminal(session, stackElement);
  if (!pt) {
    homeLog.error('failed to reconnect orphaned PTY', { ptyId: session.ptyId });
    return null;
  }

  // Wire tag button and other card actions
  setupCardActions(pt);

  // Replace default exit handler with home-view version (display exit message)
  pt.cleanupExit?.();
  pt.cleanupExit = window.api.pty.onExit(session.ptyId, (exitCode) => {
    pt.xterm.writeln('');
    const exitColor = exitCode === 0 ? '32' : '31';
    pt.xterm.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);
    pt.summary.value = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
    pt.summaryType.value = 'ready';
  });

  homeLog.info('reconnected orphaned terminal', { ptyId: session.ptyId, projectPath: session.projectPath });
  return pt;
}

/**
 * Apply depth positioning to a card or divider element.
 * Uses CSS classes for depths 1-8, inline styles for deeper levels.
 */
function applyDepthStyle(el: HTMLElement, depth: number): void {
  if (depth <= CSS_MAX_DEPTH) {
    el.classList.add(`project-card--back-${depth}`);
  } else {
    el.style.zIndex = String(10 - depth);
    el.style.transform = `translateY(-${depth * 24}px)`;
    el.style.left = `${depth}%`;
    el.style.right = `${depth}%`;
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
    'project-card--back-5',
    'project-card--back-6',
    'project-card--back-7',
    'project-card--back-8',
    'project-card--hidden',
  );
  // Clear inline positioning from dynamic depth styles
  card.style.removeProperty('z-index');
  card.style.removeProperty('transform');
  card.style.removeProperty('left');
  card.style.removeProperty('right');
}

/**
 * Show empty state in the home stack
 */
function showHomeEmptyState(): void {
  if (!homeStack) return;
  const el = document.createElement('div');
  el.className = 'project-stack-empty project-stack-empty--visible';
  el.innerHTML = `
    <div class="project-stack-empty-message">No active terminals</div>
    ${projectDataCache.size > 0 ? '<div class="home-empty-hint">Select a project from the sidebar, or</div>' : ''}
    <div class="home-empty-actions">
      <button class="home-empty-action" data-action="add-existing">
        <i data-icon="folder-open"></i>
        <span>Add existing folder</span>
      </button>
      <button class="home-empty-action" data-action="create-new">
        <i data-icon="plus"></i>
        <span>Create new project</span>
      </button>
    </div>
  `;
  convertIconsIn(el);

  el.querySelector('[data-action="add-existing"]')!.addEventListener('click', async () => {
    const result = await window.api.showFolderPicker();
    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      const addResult = await window.api.addProject(folderPath);
      if (addResult.success) {
        await (window as any).refreshProjects();
        const folderName = folderPath.split('/').pop() || folderPath;
        showToast(`Added project: ${folderName}`, 'success');
      } else {
        showToast(addResult.error || 'Failed to add project', 'error');
      }
    }
  });

  el.querySelector('[data-action="create-new"]')!.addEventListener('click', async () => {
    const result = await showNewProjectDialog();
    if (result?.created) {
      await (window as any).refreshProjects();
      showToast(`Created project: ${result.projectName}`, 'success');
    }
  });

  homeStack.appendChild(el);
}

/**
 * Seed hook status for all home terminals from main process.
 * Catches up on transitions that happened while viewing a different project.
 */
async function seedHomeHookStatus(): Promise<void> {
  const seeds = homeTerminals.map(async (term) => {
    try {
      const status = await window.api.claudeHooks.getStatus(term.ptyId);
      if (!homeViewActive.value) return; // exited during async query
      if (status) {
        term.handleHookStatus(status.status === 'thinking' ? 'thinking' : 'ready');
      }
    } catch {
      // Ignore — terminal may have exited
    }
  });
  await Promise.all(seeds);
}

/**
 * Register hook status listener for all terminals visible in home view
 */
function registerHomeHookStatusListener(): void {
  if (hookStatusCleanup) return;

  hookStatusCleanup = window.api.claudeHooks.onStatus((ptyId, status) => {
    const term = homeTerminals.find(t => t.ptyId === ptyId);
    if (!term) return;
    term.handleHookStatus(status === 'thinking' ? 'thinking' : 'ready');
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
