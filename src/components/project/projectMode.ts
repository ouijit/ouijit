/**
 * Project mode orchestration - enter/exit, session management
 */

import log from 'electron-log/renderer';
import type { Project, ActiveSession } from '../../types';
import { projectState, GIT_STATUS_PERIODIC_INTERVAL } from './state';
import {
  projectPath,
  projectData,
  diffPanelVisible,
  diffPanelFiles,
  diffPanelSelectedFile,
  kanbanVisible,
  resetSignals,
} from './signals';
import {
  hideGitDropdown,
  refreshAllTerminalGitStatus,
  shouldSkipPeriodicRefresh,
  clearAllPendingGitRefreshes,
  resetDataDrivenRefreshTimestamp,
} from './gitStatus';
import {
  hideDiffPanel,
  buildDiffPanelHtml,
  hideTerminalDiffPanel,
  wireSidebarNavigation,
  loadAllDiffs,
} from './diffPanel';
import {
  addProjectTerminal,
  updateCardStack,
  showStackEmptyState,
  closeProjectTerminal,
  setupCardActions,
  reconnectTerminal,
} from './terminalCards';
import { buildProjectHeader, toggleLaunchDropdown, hideLaunchDropdown } from './launchDropdown';
import { hideKanbanBoard, showKanbanBoard, showKanbanAndFocusInput, syncViewToggle } from './kanbanBoard';
import { projectRegistry } from './helpers';
import { OuijitTerminal, getManager } from '../terminal';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes, platformHotkey } from '../../utils/hotkeys';
import { convertIconsIn } from '../../utils/icons';
import { convertTitlesIn } from '../../utils/tooltip';

const projectLog = log.scope('project');

/**
 * Wire up event listeners on the project header buttons
 */
function wireProjectHeader(headerContent: Element): void {
  convertIconsIn(headerContent as HTMLElement);
  convertTitlesIn(headerContent, 'bottom');

  // Wire up hooks button (opens dropdown)
  const hooksBtn = headerContent.querySelector('.project-hooks-btn');
  if (hooksBtn) {
    hooksBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLaunchDropdown();
    });
  }

  // Wire up new task button (opens task overlay)
  const newTaskBtn = headerContent.querySelector('.project-newtask-btn');
  if (newTaskBtn) {
    newTaskBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showKanbanAndFocusInput();
    });
  }

  // Wire up terminal button (opens new shell)
  const terminalBtn = headerContent.querySelector('.project-terminal-btn');
  if (terminalBtn) {
    terminalBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (kanbanVisible.value) hideKanbanBoard();
      await addProjectTerminal();
    });
  }

  // Wire up view toggle buttons
  wireViewToggle(headerContent);
}

/**
 * Enter project mode for the specified project
 * If a preserved session exists, it will be restored instead of creating a new one
 */
export async function enterProjectMode(path: string, project: Project): Promise<void> {
  if (projectPath.value) return; // Already in project mode

  const manager = getManager();

  // Check for preserved session
  const existingSession = manager.getSession(path);

  // Store project data for later use in signals
  projectPath.value = path;
  projectData.value = existingSession?.projectData || project;

  // Persist last active view for session recovery
  window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'project', path }));

  // Initialize reactive effects
  manager.initializeEffects();

  // Register global Claude hook status listener
  manager.registerHookStatusListener();

  // 1. Add class to body - CSS handles the rest
  document.body.classList.add('project-mode');

  // 2. Update header content
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    headerContent.innerHTML = buildProjectHeader();
    wireProjectHeader(headerContent);
  }

  // 3. Handle stack - restore existing or create new
  // Pre-hide stack if kanban will be shown, to avoid a flash of terminals
  const willShowKanban = !existingSession || existingSession.kanbanWasVisible;
  if (willShowKanban) {
    document.body.classList.add('kanban-open');
  }

  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    if (existingSession) {
      // Restore existing session — adds terminals back to manager, reattaches
      const session = manager.restoreSession(path)!;

      // Move stack from hidden container back to main content
      mainContent.appendChild(session.stackElement);

      // Refit terminals after DOM reattachment
      for (const term of manager.terminals.value) {
        requestAnimationFrame(() => {
          term.fit();
        });
      }

      // Seed hook status from main process (may have changed while viewing another project)
      const hookSeeds = manager.terminals.value.map(async (term) => {
        const hookStatus = await window.api.claudeHooks.getStatus(term.ptyId);
        if (hookStatus) {
          term.handleHookStatus(hookStatus.status === 'thinking' ? 'thinking' : 'ready');
        }
      });
      await Promise.all(hookSeeds);
      if (!projectPath.value) return; // exited during async hook status queries

      // Focus the active terminal
      const activeTerm = manager.activeTerminal.value;
      if (activeTerm) {
        requestAnimationFrame(() => {
          activeTerm.xterm.focus();
        });
      }

      // Update card stack positions (effect handles this, but call for immediate update)
      updateCardStack();

      // Restore diff panels for terminals that had them open
      for (const term of manager.terminals.value) {
        if (term.diffPanelOpen && term.diffPanelFiles.length > 0) {
          // Re-create the diff panel inside this terminal's card
          const cardBody = term.container.querySelector('.project-card-body');
          if (cardBody) {
            const panelHtml = buildDiffPanelHtml(term.diffPanelFiles);
            cardBody.insertAdjacentHTML('beforeend', panelHtml);

            const panel = cardBody.querySelector('.diff-panel');
            if (panel) {
              const termRef = term; // Capture for closure

              // Wire up close button
              const closeBtn = panel.querySelector('.diff-panel-close');
              if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                  hideTerminalDiffPanel(termRef);
                });
              }

              // Wire sidebar navigation
              wireSidebarNavigation(panel);

              // Add class to card
              term.container.classList.add('diff-panel-open');

              // Animate panel in
              requestAnimationFrame(() => {
                panel.classList.add('diff-panel--visible');
              });

              // Load all diffs
              const isWorktreeMode = term.diffPanelMode === 'worktree';
              const gitPath = term.worktreePath || term.projectPath;
              const basePath = projectPath.value;
              loadAllDiffs(panel, term.diffPanelFiles, (filePath) => {
                if (isWorktreeMode && basePath && termRef.worktreeBranch) {
                  return window.api.worktree.getFileDiff(basePath, termRef.worktreeBranch, filePath);
                }
                return window.api.getFileDiff(gitPath, filePath);
              });
            }
          }
        }
      }

      // Update global signals for active terminal
      const currentActive = manager.activeTerminal.value;
      if (currentActive?.diffPanelOpen) {
        diffPanelFiles.value = currentActive.diffPanelFiles;
        diffPanelSelectedFile.value = currentActive.diffPanelSelectedFile;
        diffPanelVisible.value = true;
      }
    } else {
      // Create new session
      const stack = document.createElement('div');
      stack.className = 'project-stack';
      mainContent.appendChild(stack);

      // Check for orphaned PTY sessions that survived an app refresh
      const orphaned = manager.orphanedSessions.get(path);
      if (orphaned && orphaned.length > 0) {
        // Reconnect to orphaned sessions
        projectLog.info('found orphaned PTY sessions, reconnecting', { count: orphaned.length });
        manager.orphanedSessions.delete(path); // Consume them
        window.api.pty.setWindow();

        // Separate main terminals from runners
        const mainSessions = orphaned.filter((s) => !s.isRunner);
        const runnerSessions = orphaned.filter((s) => s.isRunner);

        // Override stale labels with current task names
        const allTasks = await window.api.task.getAll(path);
        const taskNameMap = new Map(allTasks.map((t) => [t.taskNumber, t.name]));

        // First reconnect main terminals
        for (const session of mainSessions) {
          if (session.taskId != null) {
            const currentName = taskNameMap.get(session.taskId);
            if (currentName) session.label = currentName;
          }
          await reconnectProjectTerminal(session);
        }

        // Then reconnect runners to their parent terminals
        for (const runnerSession of runnerSessions) {
          // Find parent terminal by matching parentPtyId
          const parentTerminal = manager.findByPtyId(runnerSession.parentPtyId!);
          if (parentTerminal) {
            await reconnectRunnerToParent(runnerSession, parentTerminal);
          } else {
            projectLog.warn('could not find parent terminal for runner', {
              ptyId: runnerSession.ptyId,
              parentPtyId: runnerSession.parentPtyId,
            });
          }
        }

        if (manager.terminals.value.length > 0) {
          updateCardStack();
        } else {
          showStackEmptyState();
        }
      } else {
        // Show empty state
        showStackEmptyState();
      }
    }
  }

  // 4. Set up keyboard shortcuts for project mode
  pushScope(Scopes.PROJECT);
  registerHotkey(platformHotkey('mod+n'), Scopes.PROJECT, () => showKanbanAndFocusInput());
  registerHotkey(platformHotkey('mod+t'), Scopes.PROJECT, () => projectRegistry.toggleKanbanBoard?.());
  registerHotkey(platformHotkey('mod+i'), Scopes.PROJECT, () => addProjectTerminal());
  registerHotkey(platformHotkey('mod+p'), Scopes.PROJECT, () => projectRegistry.playOrToggleRunner?.());
  registerHotkey(platformHotkey('mod+d'), Scopes.PROJECT, () => projectRegistry.toggleActiveDiffPanel?.());
  registerHotkey(platformHotkey('mod+w'), Scopes.PROJECT, () => {
    const activeTerm = manager.activeTerminal.value;
    if (activeTerm) {
      closeProjectTerminal(activeTerm);
    }
  });

  // Mod+1-9 to select by stack position (terminals or tasks in empty state)
  for (let i = 1; i <= 9; i++) {
    registerHotkey(platformHotkey(`mod+${i}`), Scopes.PROJECT, () => {
      manager.selectByStackPosition(i);
    });
  }

  // Mod+Shift+Left/Right to navigate stack pages
  registerHotkey(platformHotkey('mod+shift+left'), Scopes.PROJECT, () => manager.navigateStackPage(-1));
  registerHotkey(platformHotkey('mod+shift+right'), Scopes.PROJECT, () => manager.navigateStackPage(1));

  // 5. Restore view: kanban if previously visible (or first entry), otherwise terminal stack
  if (!existingSession || existingSession.kanbanWasVisible) {
    await showKanbanBoard();
  } else {
    syncViewToggle();
  }

  // 6. Start periodic git status refresh (for long-running commands)
  if (project.hasGit) {
    if (projectState.gitStatusPeriodicInterval) clearInterval(projectState.gitStatusPeriodicInterval);
    projectState.gitStatusPeriodicInterval = setInterval(() => {
      if (shouldSkipPeriodicRefresh()) return;
      refreshAllTerminalGitStatus();
    }, GIT_STATUS_PERIODIC_INTERVAL);
  }
}

/**
 * Exit project mode - preserves sessions for later restoration
 */
export function exitProjectMode(): void {
  const currentProjectPath = projectPath.value;
  if (!currentProjectPath) return;

  const manager = getManager();

  // 1. Handle session preservation or cleanup
  if (manager.terminals.value.length > 0 && projectData.value) {
    manager.preserveSession(currentProjectPath);
  } else {
    // No terminals to preserve - just remove the stack
    const stack = document.querySelector('.project-stack') as HTMLElement;
    if (stack) stack.remove();
  }

  // 2. Remove class from body
  document.body.classList.remove('project-mode');

  // 3. Clear header content (sidebar handles project navigation now)
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    headerContent.innerHTML = '';
  }

  // 4. Clean up reactive effects and hook status listener
  manager.cleanupEffects();
  manager.unregisterHookStatusListener();

  // 5. Remove keyboard shortcuts and pop scope
  unregisterHotkey(platformHotkey('mod+n'), Scopes.PROJECT);
  unregisterHotkey(platformHotkey('mod+t'), Scopes.PROJECT);
  unregisterHotkey(platformHotkey('mod+i'), Scopes.PROJECT);
  unregisterHotkey(platformHotkey('mod+p'), Scopes.PROJECT);
  unregisterHotkey(platformHotkey('mod+d'), Scopes.PROJECT);
  unregisterHotkey(platformHotkey('mod+w'), Scopes.PROJECT);
  for (let i = 1; i <= 9; i++) {
    unregisterHotkey(platformHotkey(`mod+${i}`), Scopes.PROJECT);
  }
  unregisterHotkey(platformHotkey('mod+shift+left'), Scopes.PROJECT);
  unregisterHotkey(platformHotkey('mod+shift+right'), Scopes.PROJECT);
  popScope();

  // 5. Clear git status timers
  if (projectState.gitStatusIdleTimeout) {
    clearTimeout(projectState.gitStatusIdleTimeout);
    projectState.gitStatusIdleTimeout = null;
  }
  if (projectState.gitStatusPeriodicInterval) {
    clearInterval(projectState.gitStatusPeriodicInterval);
    projectState.gitStatusPeriodicInterval = null;
  }
  clearAllPendingGitRefreshes();
  resetDataDrivenRefreshTimestamp();

  // 6. Hide and cleanup git dropdown
  hideGitDropdown();

  // 7. Hide launch dropdown
  hideLaunchDropdown();

  // 8. Hide diff panel
  hideDiffPanel();

  // 8.5. Remove pagination row
  const paginationRow = document.querySelector('.project-stack-pagination');
  if (paginationRow) paginationRow.remove();

  // 9. Hide kanban board
  hideKanbanBoard();

  // Reset all signals to initial values
  resetSignals();
}

/**
 * Permanently destroy all project sessions for a project
 * Call this when you want to truly close sessions, not just switch away
 */
export function destroyProjectSessions(path: string): void {
  getManager().destroySession(path);
}

/**
 * Get list of projects with preserved project sessions
 */
export function getPreservedSessionPaths(): string[] {
  return getManager().getPreservedSessionPaths();
}

/**
 * Check if a project has a preserved project session
 */
export function hasPreservedSession(path: string): boolean {
  return getManager().hasSession(path);
}

/**
 * Check if we're currently in project mode
 */
export function isInProjectMode(): boolean {
  return projectPath.value !== null;
}

/**
 * Restore project mode after renderer reload (e.g., after sleep/wake)
 * Reconnects to existing PTY sessions in the main process
 */
export async function restoreProjectMode(
  path: string,
  project: Project,
  activeSessions: ActiveSession[],
): Promise<void> {
  if (projectPath.value) return; // Already in project mode

  projectLog.info('restoring project mode', { path, sessions: activeSessions.length });

  const manager = getManager();

  // Update window reference in main process
  window.api.pty.setWindow();

  // Store project data
  projectPath.value = path;
  projectData.value = project;

  // Persist last active view for session recovery
  window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'project', path }));

  // Initialize reactive effects
  manager.initializeEffects();

  // Register global Claude hook status listener
  manager.registerHookStatusListener();

  // 1. Add class to body
  document.body.classList.add('project-mode');

  // 2. Update header content
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    headerContent.innerHTML = buildProjectHeader();
    wireProjectHeader(headerContent);
  }

  // 3. Create stack and restore terminals
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    const stack = document.createElement('div');
    stack.className = 'project-stack';
    mainContent.appendChild(stack);

    // Separate main terminals from runners
    const mainSessions = activeSessions.filter((s) => !s.isRunner);
    const runnerSessions = activeSessions.filter((s) => s.isRunner);

    // Fetch task data for branch lookup and label override during restoration
    const allTasks = await window.api.task.getAll(path);
    const taskBranchMap = new Map(allTasks.filter((t) => t.branch).map((t) => [t.taskNumber, t.branch!]));
    const taskNameMap = new Map(allTasks.map((t) => [t.taskNumber, t.name]));

    // First reconnect main terminals
    for (const session of mainSessions) {
      // Override stale label with current task name
      if (session.taskId != null) {
        const currentName = taskNameMap.get(session.taskId);
        if (currentName) session.label = currentName;
      }
      const worktreeBranch = session.taskId != null ? taskBranchMap.get(session.taskId) : undefined;
      await reconnectProjectTerminal(session, worktreeBranch);
    }

    // Then reconnect runners to their parent terminals
    for (const runnerSession of runnerSessions) {
      const parentTerminal = manager.findByPtyId(runnerSession.parentPtyId!);
      if (parentTerminal) {
        await reconnectRunnerToParent(runnerSession, parentTerminal);
      } else {
        projectLog.warn('could not find parent terminal for runner', {
          ptyId: runnerSession.ptyId,
          parentPtyId: runnerSession.parentPtyId,
        });
      }
    }

    if (manager.terminals.value.length > 0) {
      updateCardStack();
    } else {
      showStackEmptyState();
    }
  }

  // 4. Set up keyboard shortcuts
  pushScope(Scopes.PROJECT);
  registerHotkey(platformHotkey('mod+n'), Scopes.PROJECT, () => showKanbanAndFocusInput());
  registerHotkey(platformHotkey('mod+t'), Scopes.PROJECT, () => projectRegistry.toggleKanbanBoard?.());
  registerHotkey(platformHotkey('mod+i'), Scopes.PROJECT, () => addProjectTerminal());
  registerHotkey(platformHotkey('mod+p'), Scopes.PROJECT, () => projectRegistry.playOrToggleRunner?.());
  registerHotkey(platformHotkey('mod+d'), Scopes.PROJECT, () => projectRegistry.toggleActiveDiffPanel?.());
  registerHotkey(platformHotkey('mod+w'), Scopes.PROJECT, () => {
    const activeTerm = manager.activeTerminal.value;
    if (activeTerm) {
      closeProjectTerminal(activeTerm);
    }
  });

  // Mod+1-9 to select by stack position (terminals or tasks in empty state)
  for (let i = 1; i <= 9; i++) {
    registerHotkey(platformHotkey(`mod+${i}`), Scopes.PROJECT, () => {
      manager.selectByStackPosition(i);
    });
  }

  // Mod+Shift+Left/Right to navigate stack pages
  registerHotkey(platformHotkey('mod+shift+left'), Scopes.PROJECT, () => manager.navigateStackPage(-1));
  registerHotkey(platformHotkey('mod+shift+right'), Scopes.PROJECT, () => manager.navigateStackPage(1));

  // 5. Show kanban board by default (after PROJECT scope so KANBAN scope stacks on top)
  await showKanbanBoard();

  // 6. Refresh git status immediately and start periodic refresh
  if (project.hasGit) {
    // Immediate refresh so git info shows right away
    refreshAllTerminalGitStatus();

    // Periodic refresh for ongoing changes
    if (projectState.gitStatusPeriodicInterval) clearInterval(projectState.gitStatusPeriodicInterval);
    projectState.gitStatusPeriodicInterval = setInterval(() => {
      if (shouldSkipPeriodicRefresh()) return;
      refreshAllTerminalGitStatus();
    }, GIT_STATUS_PERIODIC_INTERVAL);
  }
}

/**
 * Reconnect to an existing PTY session and create a terminal card for it
 */
async function reconnectProjectTerminal(session: ActiveSession, worktreeBranch?: string): Promise<void> {
  const stack = document.querySelector('.project-stack');
  if (!stack) return;

  const manager = getManager();

  // Query main-process hook status for correct initial state
  const hookStatus = await window.api.claudeHooks.getStatus(session.ptyId);
  const initialStatus = hookStatus?.status === 'thinking' ? ('thinking' as const) : ('ready' as const);

  const term = await reconnectTerminal(session, stack as HTMLElement, {
    worktreeBranch,
    initialStatus,
  });

  // Guard: project mode may have been exited during the async reconnect
  if (!term || !projectPath.value) {
    if (term) {
      term.xterm.dispose();
      term.container.remove();
    }
    return;
  }

  // Add to manager (wires close/click handlers automatically)
  manager.add(term);

  // Replace default exit handler with project-mode auto-close
  term.cleanupExit?.();
  term.cleanupExit = window.api.pty.onExit(session.ptyId, () => {
    projectLog.info('terminal exited', { ptyId: session.ptyId });
    closeProjectTerminal(term);
  });

  // Set up card action buttons (runner pill for all, close-task for worktrees)
  setupCardActions(term);

  // Mark sandboxed terminals
  if (term.sandboxed) {
    const dot = term.container.querySelector('.project-card-status-dot');
    if (dot) dot.classList.add('project-card-status-dot--sandboxed');
  }

  // Focus if this is the first terminal
  if (manager.terminals.value.length === 1) {
    term.xterm.focus();
  }
}

/**
 * Reconnect a runner PTY to its parent terminal
 */
async function reconnectRunnerToParent(session: ActiveSession, parentTerminal: OuijitTerminal): Promise<void> {
  // Create runner terminal (hidden until panel is opened)
  const runner = new OuijitTerminal({
    ptyId: session.ptyId,
    projectPath: session.projectPath,
    command: session.command,
    label: session.label,
    isRunner: true,
  });

  // Open xterm but don't add to DOM — it will be opened into panel when showRunnerPanel is called
  // We need the xterm instance alive so we can receive and buffer PTY data
  const tempContainer = document.createElement('div');
  tempContainer.style.display = 'none';
  document.body.appendChild(tempContainer);
  tempContainer.appendChild(runner.container);
  runner.openTerminal();

  // Reconnect to existing PTY
  const result = await window.api.pty.reconnect(session.ptyId);

  // Guard: project mode may have been exited or parent closed during async reconnect
  if (!projectPath.value || !getManager().terminals.value.includes(parentTerminal)) {
    runner.xterm.dispose();
    runner.container.remove();
    tempContainer.remove();
    return;
  }

  if (!result.success) {
    projectLog.error('failed to reconnect runner PTY', { ptyId: session.ptyId, error: result.error });
    runner.xterm.dispose();
    runner.container.remove();
    tempContainer.remove();
    return;
  }

  // Replay buffered output
  runner.replayBuffer(result.bufferedOutput, result.lastCols, result.isAltScreen);

  // Bind with runner-specific handlers
  runner.bind(session.ptyId, {
    skipSideEffects: true,
    onData: (data) => {
      // Extract OSC title sequences to update runner label
      const oscMatches = data.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
      for (const match of oscMatches) {
        if (match[1]) {
          parentTerminal.runnerCommand = match[1];
          parentTerminal.updateRunnerPill();
          const panelTitle = parentTerminal.container.querySelector('.runner-panel-title');
          if (panelTitle) panelTitle.textContent = match[1];
        }
      }
    },
    onExit: (exitCode) => {
      parentTerminal.runnerStatus = exitCode === 0 ? 'success' : 'error';
      parentTerminal.updateRunnerPill();
    },
  });

  // Set runner status to running (it's being restored from a live process)
  parentTerminal.runnerStatus = 'running';

  // Attach runner to parent
  parentTerminal.setRunner(runner);

  // Clean up temp container (runner DOM is now owned by parent via setRunner)
  tempContainer.remove();

  projectLog.info('reconnected runner to parent terminal', {
    runnerPtyId: session.ptyId,
    parentPtyId: parentTerminal.ptyId,
  });
}

/**
 * Wire up the view toggle buttons in the header
 */
function wireViewToggle(headerContent: Element): void {
  const toggleBtns = headerContent.querySelectorAll('.project-view-toggle-btn');
  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const view = (btn as HTMLElement).dataset.view;
      if (view === 'board') {
        showKanbanBoard();
      } else {
        hideKanbanBoard();
      }
    });
  });
}
