/**
 * Theatre mode orchestration - enter/exit, session management
 */

import { createIcons, Maximize2, Minimize2, RefreshCw, GitBranch, GitBranchPlus, ChevronDown, Play, Plus, FolderOpen, Upload, Star, X, GitMerge, Terminal } from 'lucide';
import type { Project, RunConfig, ChangedFile } from '../../types';
import {
  theatreState,
  projectSessions,
  ensureHiddenSessionsContainer,
  GIT_STATUS_PERIODIC_INTERVAL,
} from './state';
import {
  projectPath,
  projectData,
  terminals,
  activeIndex,
  diffPanelVisible,
  diffPanelFiles,
  diffPanelSelectedFile,
  resetSignals,
} from './signals';
import { initializeEffects } from './effects';
import {
  hideGitDropdown,
  refreshGitStatus,
  refreshAllTerminalGitStatus,
} from './gitStatus';
import {
  toggleDiffPanel,
  hideDiffPanel,
  buildDiffPanelHtml,
  selectDiffFile,
  toggleDiffFileDropdown,
} from './diffPanel';
import {
  addTheatreTerminal,
  updateCardStack,
  showStackEmptyState,
} from './terminalCards';
import {
  buildTheatreHeader,
  toggleLaunchDropdown,
  hideLaunchDropdown,
  runDefaultCommand,
} from './launchDropdown';
import { toggleWorktreeDropdown } from './worktreeDropdown';

const theatreIcons = { Maximize2, Minimize2, RefreshCw, GitBranch, GitBranchPlus, ChevronDown, Play, Plus, FolderOpen, Upload, Star, X, GitMerge, Terminal };

/**
 * Enter theatre mode for the specified project
 * If a preserved session exists, it will be restored instead of creating a new one
 */
export async function enterTheatreMode(
  path: string,
  project: Project,
  runConfig?: RunConfig
): Promise<void> {
  if (projectPath.value) return; // Already in theatre mode

  // Check for preserved session
  const existingSession = projectSessions.get(path);

  // Store project data for later use in signals
  projectPath.value = path;
  projectData.value = existingSession?.projectData || project;

  // Initialize reactive effects
  initializeEffects();

  // 1. Add class to body - CSS handles the rest
  document.body.classList.add('theatre-mode');

  // 2. Update header content
  // Note: Git status is now displayed per-terminal on card labels, not in the header
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    theatreState.originalHeaderContent = headerContent.innerHTML;
    headerContent.innerHTML = buildTheatreHeader();
    createIcons({ icons: theatreIcons, nodes: [headerContent as HTMLElement] });

    // Wire up exit button
    const exitBtn = headerContent.querySelector('.theatre-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => exitTheatreMode());
    }

    // Wire up play button (runs default command)
    const playBtn = headerContent.querySelector('.theatre-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await runDefaultCommand();
      });
    }

    // Wire up worktree button
    const worktreeBtn = headerContent.querySelector('.theatre-worktree-btn');
    if (worktreeBtn) {
      worktreeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWorktreeDropdown();
      });
    }

    // Wire up terminal button (creates plain shell)
    const terminalBtn = headerContent.querySelector('.theatre-terminal-btn');
    if (terminalBtn) {
      terminalBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await addTheatreTerminal();
      });
    }

    // Wire up chevron button (opens dropdown)
    const chevronBtn = headerContent.querySelector('.theatre-launch-chevron-btn');
    if (chevronBtn) {
      chevronBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLaunchDropdown();
      });
    }
  }

  // 3. Handle stack - restore existing or create new
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    if (existingSession) {
      // Restore existing session into signals
      terminals.value = existingSession.terminals;
      activeIndex.value = existingSession.activeIndex;

      // Move stack from hidden container back to main content
      mainContent.appendChild(existingSession.stackElement);

      // Reconnect resize observers and refit terminals
      for (const term of terminals.value) {
        const xtermContainer = term.container.querySelector('.terminal-xterm-container') as HTMLElement;
        if (xtermContainer) {
          term.resizeObserver = new ResizeObserver(() => {
            term.fitAddon.fit();
            window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
          });
          term.resizeObserver.observe(xtermContainer);
        }

        // Refit after DOM reattachment
        requestAnimationFrame(() => {
          term.fitAddon.fit();
          window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
        });
      }

      // Focus the active terminal (effect will handle this too, but ensure immediate focus)
      const currentTerminals = terminals.value;
      const currentActiveIndex = activeIndex.value;
      if (currentTerminals.length > 0) {
        requestAnimationFrame(() => {
          currentTerminals[currentActiveIndex].terminal.focus();
        });
      }

      // Remove from preserved sessions (now active)
      projectSessions.delete(path);

      // Update card stack positions (effect handles this, but call for immediate update)
      updateCardStack();

      // Restore diff panels for terminals that had them open
      // Diff panels are now inside each card, so we rebuild them
      for (const term of currentTerminals) {
        if (term.diffPanelOpen && term.diffPanelFiles.length > 0) {
          // Re-create the diff panel inside this terminal's card
          const cardBody = term.container.querySelector('.theatre-card-body');
          if (cardBody) {
            const panelHtml = buildDiffPanelHtml(term.diffPanelFiles);
            cardBody.insertAdjacentHTML('beforeend', panelHtml);

            const panel = cardBody.querySelector('.diff-panel');
            if (panel) {
              createIcons({ icons: theatreIcons, nodes: [panel as Element] });

              // Wire up file selector dropdown toggle
              const fileSelector = panel.querySelector('.diff-file-selector');
              if (fileSelector) {
                fileSelector.addEventListener('click', (e) => {
                  e.stopPropagation();
                  toggleDiffFileDropdown();
                });
              }

              // Wire up close button
              const closeBtn = panel.querySelector('.diff-panel-close');
              if (closeBtn) {
                const termRef = term; // Capture for closure
                closeBtn.addEventListener('click', async () => {
                  const { hideTerminalDiffPanel } = await import('./diffPanel');
                  hideTerminalDiffPanel(termRef);
                });
              }

              // Add class to card
              term.container.classList.add('diff-panel-open');

              // Animate panel in
              requestAnimationFrame(() => {
                panel.classList.add('diff-panel--visible');
              });

              // Select the previously selected file (or first file)
              const fileToSelect = term.diffPanelSelectedFile || term.diffPanelFiles[0]?.path;
              if (fileToSelect) {
                const { selectTerminalDiffFile } = await import('./diffPanel');
                selectTerminalDiffFile(term, fileToSelect);
              }
            }
          }
        }
      }

      // Update global signals for active terminal
      const activeTerm = currentTerminals[currentActiveIndex];
      if (activeTerm?.diffPanelOpen) {
        diffPanelFiles.value = activeTerm.diffPanelFiles;
        diffPanelSelectedFile.value = activeTerm.diffPanelSelectedFile;
        diffPanelVisible.value = true;
      }
    } else {
      // Create new session - signals start with empty arrays
      terminals.value = [];
      activeIndex.value = 0;

      const stack = document.createElement('div');
      stack.className = 'theatre-stack';
      mainContent.appendChild(stack);

      // Only create terminal if a specific command was requested
      if (runConfig) {
        await addTheatreTerminal(runConfig);
      } else {
        // No command requested - show empty state
        showStackEmptyState();
      }
    }
  }

  // 4. Keyboard handler (Escape to exit)
  theatreState.escapeKeyHandler = (e) => {
    if (e.key === 'Escape') exitTheatreMode();
  };
  document.addEventListener('keydown', theatreState.escapeKeyHandler);

  // 5. Start periodic git status refresh (for long-running commands)
  // This now refreshes all terminals' git status
  if (project.hasGit) {
    theatreState.gitStatusPeriodicInterval = setInterval(() => {
      refreshGitStatus();
      refreshAllTerminalGitStatus().then(() => {
        // Import dynamically to update card labels
        import('./terminalCards').then(({ updateTerminalCardLabel }) => {
          for (const term of terminals.value) {
            updateTerminalCardLabel(term);
          }
        });
      });
    }, GIT_STATUS_PERIODIC_INTERVAL);
  }
}

/**
 * Exit theatre mode - preserves sessions for later restoration
 */
export function exitTheatreMode(): void {
  const currentProjectPath = projectPath.value;
  if (!currentProjectPath) return;

  const currentTerminals = terminals.value;
  const currentProjectData = projectData.value;

  // 1. Handle session preservation or cleanup
  const stack = document.querySelector('.theatre-stack') as HTMLElement;
  if (stack) {
    if (currentTerminals.length > 0 && currentProjectData) {
      // Store session for later restoration
      // Disconnect resize observers while hidden (will reconnect on restore)
      for (const term of currentTerminals) {
        if (term.resizeObserver) {
          term.resizeObserver.disconnect();
        }
      }

      // Move stack to hidden container
      const hiddenContainer = ensureHiddenSessionsContainer();
      hiddenContainer.appendChild(stack);

      // Store session data including diff panel state
      projectSessions.set(currentProjectPath, {
        terminals: [...currentTerminals],
        activeIndex: activeIndex.value,
        projectData: currentProjectData,
        stackElement: stack,
        diffPanelWasOpen: diffPanelVisible.value,
        diffSelectedFile: diffPanelSelectedFile.value,
        diffFiles: [...diffPanelFiles.value],
      });
    } else {
      // No terminals to preserve - just remove the stack
      stack.remove();
    }
  }

  // 2. Remove class from body
  document.body.classList.remove('theatre-mode');

  // 3. Restore header content
  const headerContent = document.querySelector('.header-content');
  if (headerContent && theatreState.originalHeaderContent) {
    headerContent.innerHTML = theatreState.originalHeaderContent;
    createIcons({ icons: theatreIcons, nodes: [headerContent as HTMLElement] });
    // Re-attach refresh handler with full behavior
    const refreshBtn = headerContent.querySelector('#refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('spinning');
        refreshBtn.setAttribute('disabled', 'true');
        try {
          await (window as any).refreshProjects?.();
        } finally {
          refreshBtn.classList.remove('spinning');
          refreshBtn.removeAttribute('disabled');
        }
      });
    }
    // Re-attach new project handler
    const newProjectBtn = headerContent.querySelector('#new-project-btn');
    if (newProjectBtn) {
      newProjectBtn.addEventListener('click', async () => {
        const { showNewProjectDialog } = await import('../newProjectDialog');
        const result = await showNewProjectDialog();
        if (result?.created) {
          await (window as any).refreshProjects?.();
          const { showToast } = await import('../importDialog');
          showToast(`Created project: ${result.projectName}`, 'success');
        }
      });
    }
  }

  // 4. Remove escape handler
  if (theatreState.escapeKeyHandler) {
    document.removeEventListener('keydown', theatreState.escapeKeyHandler);
    theatreState.escapeKeyHandler = null;
  }

  // 5. Clear git status timers
  if (theatreState.gitStatusIdleTimeout) {
    clearTimeout(theatreState.gitStatusIdleTimeout);
    theatreState.gitStatusIdleTimeout = null;
  }
  if (theatreState.gitStatusPeriodicInterval) {
    clearInterval(theatreState.gitStatusPeriodicInterval);
    theatreState.gitStatusPeriodicInterval = null;
  }

  // 6. Hide and cleanup git dropdown
  hideGitDropdown();

  // 7. Hide launch dropdown
  hideLaunchDropdown();

  // 8. Hide diff panel
  hideDiffPanel();

  theatreState.originalHeaderContent = null;

  // Reset all signals to initial values
  resetSignals();
}

/**
 * Permanently destroy all theatre sessions for a project
 * Call this when you want to truly close sessions, not just switch away
 */
export function destroyTheatreSessions(projectPath: string): void {
  const session = projectSessions.get(projectPath);
  if (!session) return;

  // Kill all PTYs and clean up
  for (const term of session.terminals) {
    window.api.pty.kill(term.ptyId);
    if (term.cleanupData) term.cleanupData();
    if (term.cleanupExit) term.cleanupExit();
    if (term.resizeObserver) term.resizeObserver.disconnect();
    term.terminal.dispose();
    term.container.remove();
  }

  // Remove stack element
  session.stackElement.remove();

  // Remove from storage
  projectSessions.delete(projectPath);
}

/**
 * Get list of projects with preserved theatre sessions
 */
export function getPreservedSessionPaths(): string[] {
  return Array.from(projectSessions.keys());
}

/**
 * Check if a project has a preserved theatre session
 */
export function hasPreservedSession(projectPath: string): boolean {
  return projectSessions.has(projectPath);
}

/**
 * Check if we're currently in theatre mode
 */
export function isInTheatreMode(): boolean {
  return projectPath.value !== null;
}
