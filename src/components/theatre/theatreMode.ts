/**
 * Theatre mode orchestration - enter/exit, session management
 */

import type { Project, ChangedFile, ActiveSession } from '../../types';
import {
  theatreState,
  projectSessions,
  orphanedSessions,
  ensureHiddenSessionsContainer,
  GIT_STATUS_PERIODIC_INTERVAL,
  TheatreTerminal,
} from './state';
import {
  projectPath,
  projectData,
  terminals,
  activeIndex,
  diffPanelVisible,
  diffPanelFiles,
  diffPanelSelectedFile,
  sandboxDropdownVisible,
  resetSignals,
} from './signals';
import { initializeEffects } from './effects';
import {
  hideGitDropdown,
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
  switchToTheatreTerminal,
  selectByStackPosition,
  setupCardActions,
  setupTerminalAppHotkeys,
  debouncedResize,
} from './terminalCards';
import {
  buildTheatreHeader,
  toggleLaunchDropdown,
  hideLaunchDropdown,
} from './launchDropdown';
import { createNewAgentShell } from './worktreeDropdown';
import { toggleTaskIndex } from './taskIndex';
import { theatreRegistry } from './helpers';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes, platformHotkey } from '../../utils/hotkeys';

/**
 * Enter theatre mode for the specified project
 * If a preserved session exists, it will be restored instead of creating a new one
 */
export async function enterTheatreMode(
  path: string,
  project: Project
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

    // Wire up exit button
    const exitBtn = headerContent.querySelector('.theatre-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => exitTheatreMode());
    }

    // Wire up scripts button (opens dropdown)
    const scriptsBtn = headerContent.querySelector('.theatre-scripts-btn');
    if (scriptsBtn) {
      scriptsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLaunchDropdown();
      });
    }

    // Wire up new task button (opens task overlay)
    const newTaskBtn = headerContent.querySelector('.theatre-newtask-btn');
    if (newTaskBtn) {
      newTaskBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createNewAgentShell();
      });
    }

    // Wire up terminal button (opens new shell)
    const terminalBtn = headerContent.querySelector('.theatre-terminal-btn');
    if (terminalBtn) {
      terminalBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await addTheatreTerminal();
      });
    }

    // Wire up sandbox button (dropdown)
    const sandboxWrapper = headerContent.querySelector('.theatre-sandbox-wrapper') as HTMLElement;
    if (sandboxWrapper) {
      wireSandboxButton(sandboxWrapper, path);
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
            debouncedResize(term.ptyId, term.terminal, term.fitAddon);
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

      // Check for orphaned PTY sessions that survived an app refresh
      const orphaned = orphanedSessions.get(path);
      if (orphaned && orphaned.length > 0) {
        // Reconnect to orphaned sessions
        console.log('[Theatre] Found orphaned PTY sessions, reconnecting:', orphaned);
        orphanedSessions.delete(path); // Consume them
        window.api.pty.setWindow();

        // Separate main terminals from runners
        const mainSessions = orphaned.filter(s => !s.isRunner);
        const runnerSessions = orphaned.filter(s => s.isRunner);

        // First reconnect main terminals
        for (const session of mainSessions) {
          await reconnectTheatreTerminal(session);
        }

        // Then reconnect runners to their parent terminals
        for (const runnerSession of runnerSessions) {
          // Find parent terminal by matching parentPtyId
          const parentTerminal = terminals.value.find(t => t.ptyId === runnerSession.parentPtyId);
          if (parentTerminal) {
            await reconnectRunnerToParent(runnerSession, parentTerminal);
          } else {
            console.warn('[Theatre] Could not find parent terminal for runner:', runnerSession.ptyId, 'parent:', runnerSession.parentPtyId);
          }
        }

        if (terminals.value.length > 0) {
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

  // 4. Set up keyboard shortcuts for theatre mode
  // Use platformHotkey() to convert 'mod+' to 'command+' on Mac or 'ctrl+' on Linux/Windows
  pushScope(Scopes.THEATRE);
  registerHotkey(platformHotkey('mod+n'), Scopes.THEATRE, () => createNewAgentShell());
  registerHotkey(platformHotkey('mod+t'), Scopes.THEATRE, () => toggleTaskIndex());
  registerHotkey(platformHotkey('mod+i'), Scopes.THEATRE, () => addTheatreTerminal());
  registerHotkey(platformHotkey('mod+p'), Scopes.THEATRE, () => theatreRegistry.playOrToggleRunner?.());
  registerHotkey(platformHotkey('mod+d'), Scopes.THEATRE, () => theatreRegistry.toggleActiveDiffPanel?.());
  registerHotkey(platformHotkey('mod+shift+s'), Scopes.THEATRE, () => theatreRegistry.toggleActiveShipItPanel?.());
  registerHotkey(platformHotkey('mod+w'), Scopes.THEATRE, () => {
    if (terminals.value.length > 0) {
      import('./terminalCards').then(({ closeTheatreTerminal }) => {
        closeTheatreTerminal(activeIndex.value);
      });
    }
  });

  // Mod+1-9 to select by stack position (terminals or tasks in empty state)
  for (let i = 1; i <= 9; i++) {
    registerHotkey(platformHotkey(`mod+${i}`), Scopes.THEATRE, () => {
      selectByStackPosition(i);
    });
  }

  // 5. Start periodic git status refresh (for long-running commands)
  if (project.hasGit) {
    theatreState.gitStatusPeriodicInterval = setInterval(() => {
      refreshAllTerminalGitStatus().then(() => {
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

  // 4. Remove keyboard shortcuts and pop scope
  unregisterHotkey(platformHotkey('mod+n'), Scopes.THEATRE);
  unregisterHotkey(platformHotkey('mod+t'), Scopes.THEATRE);
  unregisterHotkey(platformHotkey('mod+i'), Scopes.THEATRE);
  unregisterHotkey(platformHotkey('mod+p'), Scopes.THEATRE);
  unregisterHotkey(platformHotkey('mod+d'), Scopes.THEATRE);
  unregisterHotkey(platformHotkey('mod+shift+s'), Scopes.THEATRE);
  unregisterHotkey(platformHotkey('mod+w'), Scopes.THEATRE);
  for (let i = 1; i <= 9; i++) {
    unregisterHotkey(platformHotkey(`mod+${i}`), Scopes.THEATRE);
  }
  popScope();

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

  // 7.5. Hide sandbox dropdown
  hideSandboxDropdown();

  // 8. Hide diff panel
  hideDiffPanel();

  // 9. Hide task index panel
  import('./taskIndex').then(({ hideTaskIndex }) => hideTaskIndex());

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

/**
 * Restore theatre mode after renderer reload (e.g., after sleep/wake)
 * Reconnects to existing PTY sessions in the main process
 */
export async function restoreTheatreMode(
  path: string,
  project: Project,
  activeSessions: ActiveSession[]
): Promise<void> {
  if (projectPath.value) return; // Already in theatre mode

  console.log('[Theatre] Restoring theatre mode for', path, 'with', activeSessions.length, 'sessions');

  // Update window reference in main process
  window.api.pty.setWindow();

  // Store project data
  projectPath.value = path;
  projectData.value = project;

  // Initialize reactive effects
  initializeEffects();

  // 1. Add class to body
  document.body.classList.add('theatre-mode');

  // 2. Update header content
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    theatreState.originalHeaderContent = headerContent.innerHTML;
    headerContent.innerHTML = buildTheatreHeader();

    // Wire up exit button
    const exitBtn = headerContent.querySelector('.theatre-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => exitTheatreMode());
    }

    // Wire up scripts button (opens dropdown)
    const scriptsBtn = headerContent.querySelector('.theatre-scripts-btn');
    if (scriptsBtn) {
      scriptsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLaunchDropdown();
      });
    }

    // Wire up new task button (opens task overlay)
    const newTaskBtn = headerContent.querySelector('.theatre-newtask-btn');
    if (newTaskBtn) {
      newTaskBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createNewAgentShell();
      });
    }

    // Wire up terminal button (opens new shell)
    const terminalBtn = headerContent.querySelector('.theatre-terminal-btn');
    if (terminalBtn) {
      terminalBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await addTheatreTerminal();
      });
    }

    // Wire up sandbox button (dropdown)
    const sandboxWrapper = headerContent.querySelector('.theatre-sandbox-wrapper') as HTMLElement;
    if (sandboxWrapper) {
      wireSandboxButton(sandboxWrapper, path);
    }

  }

  // 3. Create stack and restore terminals
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    terminals.value = [];
    activeIndex.value = 0;

    const stack = document.createElement('div');
    stack.className = 'theatre-stack';
    mainContent.appendChild(stack);

    // Separate main terminals from runners
    const mainSessions = activeSessions.filter(s => !s.isRunner);
    const runnerSessions = activeSessions.filter(s => s.isRunner);

    // Fetch task data for branch lookup during restoration
    const allTasks = await window.api.task.getAll(path);
    const taskBranchMap = new Map(allTasks.filter(t => t.branch).map(t => [t.taskNumber, t.branch!]));

    // First reconnect main terminals
    for (const session of mainSessions) {
      const worktreeBranch = session.taskId != null ? taskBranchMap.get(session.taskId) : undefined;
      await reconnectTheatreTerminal(session, worktreeBranch);
    }

    // Then reconnect runners to their parent terminals
    for (const runnerSession of runnerSessions) {
      const parentTerminal = terminals.value.find(t => t.ptyId === runnerSession.parentPtyId);
      if (parentTerminal) {
        await reconnectRunnerToParent(runnerSession, parentTerminal);
      } else {
        console.warn('[Theatre] Could not find parent terminal for runner:', runnerSession.ptyId, 'parent:', runnerSession.parentPtyId);
      }
    }

    if (terminals.value.length > 0) {
      updateCardStack();
    } else {
      showStackEmptyState();
    }
  }

  // 4. Set up keyboard shortcuts
  pushScope(Scopes.THEATRE);
  registerHotkey(platformHotkey('mod+n'), Scopes.THEATRE, () => createNewAgentShell());
  registerHotkey(platformHotkey('mod+t'), Scopes.THEATRE, () => toggleTaskIndex());
  registerHotkey(platformHotkey('mod+i'), Scopes.THEATRE, () => addTheatreTerminal());
  registerHotkey(platformHotkey('mod+p'), Scopes.THEATRE, () => theatreRegistry.playOrToggleRunner?.());
  registerHotkey(platformHotkey('mod+d'), Scopes.THEATRE, () => theatreRegistry.toggleActiveDiffPanel?.());
  registerHotkey(platformHotkey('mod+shift+s'), Scopes.THEATRE, () => theatreRegistry.toggleActiveShipItPanel?.());
  registerHotkey(platformHotkey('mod+w'), Scopes.THEATRE, () => {
    if (terminals.value.length > 0) {
      import('./terminalCards').then(({ closeTheatreTerminal }) => {
        closeTheatreTerminal(activeIndex.value);
      });
    }
  });

  // Mod+1-9 to select by stack position (terminals or tasks in empty state)
  for (let i = 1; i <= 9; i++) {
    registerHotkey(platformHotkey(`mod+${i}`), Scopes.THEATRE, () => {
      selectByStackPosition(i);
    });
  }

  // 5. Refresh git status immediately and start periodic refresh
  if (project.hasGit) {
    // Immediate refresh so git info shows right away
    refreshAllTerminalGitStatus().then(() => {
      import('./terminalCards').then(({ updateTerminalCardLabel }) => {
        for (const term of terminals.value) {
          updateTerminalCardLabel(term);
        }
      });
    });

    // Periodic refresh for ongoing changes
    theatreState.gitStatusPeriodicInterval = setInterval(() => {
      refreshAllTerminalGitStatus().then(() => {
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
 * Reconnect to an existing PTY session and create a terminal card for it
 */
async function reconnectTheatreTerminal(session: ActiveSession, worktreeBranch?: string): Promise<void> {
  const { Terminal } = await import('@xterm/xterm');
  const { FitAddon } = await import('@xterm/addon-fit');
  const { getTerminalTheme, createTheatreCard, updateTerminalCardLabel } = await import('./terminalCards');

  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 13,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    lineHeight: 1.2,
    theme: getTerminalTheme(),
    allowTransparency: true,
    scrollback: 10000,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // Create the card UI
  const index = terminals.value.length;
  const card = createTheatreCard(session.label, index);

  // Add to DOM
  const stack = document.querySelector('.theatre-stack');
  if (!stack) return;
  stack.appendChild(card);

  const xtermContainer = card.querySelector('.terminal-xterm-container') as HTMLElement;

  // Open terminal in container
  terminal.open(xtermContainer);

  // Let app hotkeys pass through xterm (needed for Linux where Ctrl+key combos are captured)
  setupTerminalAppHotkeys(terminal);

  // Enable native drag/drop on the terminal
  // xterm.js creates a .xterm-screen element that captures all mouse events
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
      if (paths) {
        terminal.paste(paths);
      }
    }
  });

  // Fit after opening
  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  // Reconnect to existing PTY
  const result = await window.api.pty.reconnect(session.ptyId);

  // Guard: theatre mode may have been exited during the async reconnect
  if (!projectPath.value) {
    terminal.dispose();
    card.remove();
    return;
  }

  if (!result.success) {
    console.error('[Theatre] Failed to reconnect to PTY:', session.ptyId, result.error);
    card.remove();
    terminal.dispose();
    return;
  }

  // Replay buffered output (scroll history)
  if (result.bufferedOutput) {
    // Reset terminal state first
    terminal.reset();
    // Write the full buffered history
    terminal.write(result.bufferedOutput);
  }

  // Set up resize observer with debouncing to prevent zsh artifacts during animations
  const resizeObserver = new ResizeObserver(() => {
    debouncedResize(session.ptyId, terminal, fitAddon);
  });
  resizeObserver.observe(xtermContainer);

  // Trigger resize to sync terminal size and force TUI apps to redraw
  setTimeout(() => {
    debouncedResize(session.ptyId, terminal, fitAddon);
  }, 50);

  // Create terminal object
  const theatreTerminal: TheatreTerminal = {
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
    summaryType: 'idle',
    outputBuffer: '',
    lastOscTitle: '',
    taskId: session.taskId ?? null,
    worktreePath: session.worktreePath,
    worktreeBranch,
    gitStatus: null,
    diffPanelOpen: false,
    diffPanelFiles: [],
    diffPanelSelectedFile: null,
    diffPanelMode: (session.taskId != null) ? 'worktree' : 'uncommitted',
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
  };

  // Set up close button handler
  const closeBtn = card.querySelector('.theatre-card-close') as HTMLButtonElement;
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = terminals.value.indexOf(theatreTerminal);
      if (idx !== -1) {
        import('./terminalCards').then(({ closeTheatreTerminal }) => {
          closeTheatreTerminal(idx);
        });
      }
    });
  }

  // Card click handler (to bring to front)
  card.addEventListener('click', () => {
    const idx = terminals.value.indexOf(theatreTerminal);
    if (idx !== -1 && idx !== activeIndex.value) {
      import('./terminalCards').then(({ switchToTheatreTerminal }) => {
        switchToTheatreTerminal(idx);
      });
    }
  });

  // Set up data handler
  const cleanupData = window.api.pty.onData(session.ptyId, (data) => {
    terminal.write(data);
    theatreTerminal.outputBuffer += data;
    // Limit buffer size
    if (theatreTerminal.outputBuffer.length > 50000) {
      theatreTerminal.outputBuffer = theatreTerminal.outputBuffer.slice(-25000);
    }
  });
  theatreTerminal.cleanupData = cleanupData;

  // Set up exit handler
  const cleanupExit = window.api.pty.onExit(session.ptyId, () => {
    console.log('[Theatre] Terminal exited:', session.ptyId);
    const idx = terminals.value.indexOf(theatreTerminal);
    if (idx !== -1) {
      import('./terminalCards').then(({ closeTheatreTerminal }) => {
        closeTheatreTerminal(idx);
      });
    }
  });
  theatreTerminal.cleanupExit = cleanupExit;

  // Forward input to PTY
  terminal.onData((data) => {
    window.api.pty.write(session.ptyId, data);
  });

  // Add to terminals array
  terminals.value = [...terminals.value, theatreTerminal];

  // Set up card action buttons (runner pill for all, close-task for worktrees)
  setupCardActions(theatreTerminal);

  // Update card label
  updateTerminalCardLabel(theatreTerminal);

  // Focus if this is the first terminal
  if (terminals.value.length === 1) {
    terminal.focus();
  }
}

/**
 * Reconnect a runner PTY to its parent terminal
 */
async function reconnectRunnerToParent(
  session: ActiveSession,
  parentTerminal: TheatreTerminal
): Promise<void> {
  const { Terminal } = await import('@xterm/xterm');
  const { FitAddon } = await import('@xterm/addon-fit');
  const { getTerminalTheme, updateRunnerPill } = await import('./terminalCards');

  // Create runner terminal (hidden until panel is opened)
  const runnerTerminal = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: false,
    cursorStyle: 'bar',
    allowTransparency: true,
    scrollback: 10000,
  });

  const runnerFitAddon = new FitAddon();
  runnerTerminal.loadAddon(runnerFitAddon);

  // Let app hotkeys pass through xterm
  setupTerminalAppHotkeys(runnerTerminal);

  // Reconnect to existing PTY
  const result = await window.api.pty.reconnect(session.ptyId);

  // Guard: theatre mode may have been exited or parent closed during async reconnect
  if (!projectPath.value || !terminals.value.includes(parentTerminal)) {
    runnerTerminal.dispose();
    return;
  }

  if (!result.success) {
    console.error('[Theatre] Failed to reconnect runner PTY:', session.ptyId, result.error);
    runnerTerminal.dispose();
    return;
  }

  // Set up parent terminal's runner state
  parentTerminal.runnerPtyId = session.ptyId;
  parentTerminal.runnerTerminal = runnerTerminal;
  parentTerminal.runnerFitAddon = runnerFitAddon;
  parentTerminal.runnerLabel = session.label;
  parentTerminal.runnerStatus = 'running'; // Assume running since it's being restored

  // Replay buffered output
  if (result.bufferedOutput) {
    runnerTerminal.reset();
    runnerTerminal.write(result.bufferedOutput);
  }

  // Set up data handler
  parentTerminal.runnerCleanupData = window.api.pty.onData(session.ptyId, (data) => {
    runnerTerminal.write(data);

    // Extract OSC title sequences to update runner label
    const oscMatches = data.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
    for (const match of oscMatches) {
      if (match[1]) {
        parentTerminal.runnerLabel = match[1];
        updateRunnerPill(parentTerminal);
        // Update panel title if visible
        const panelTitle = parentTerminal.container.querySelector('.runner-panel-title');
        if (panelTitle) {
          panelTitle.textContent = match[1];
        }
      }
    }
  });

  // Set up exit handler
  parentTerminal.runnerCleanupExit = window.api.pty.onExit(session.ptyId, (exitCode) => {
    runnerTerminal.writeln('');
    const exitColor = exitCode === 0 ? '32' : '31';
    runnerTerminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);

    parentTerminal.runnerStatus = exitCode === 0 ? 'success' : 'error';
    updateRunnerPill(parentTerminal);
  });

  // Forward terminal input to PTY
  runnerTerminal.onData((data) => {
    if (parentTerminal.runnerPtyId) {
      window.api.pty.write(parentTerminal.runnerPtyId, data);
    }
  });

  // Update runner pill to show running state
  updateRunnerPill(parentTerminal);

  console.log('[Theatre] Reconnected runner to parent terminal:', session.ptyId, '->', parentTerminal.ptyId);
}

/**
 * Wire up the sandbox button to open a dropdown
 */
function wireSandboxButton(wrapper: HTMLElement, path: string): void {
  // Guard against double-wiring
  if (wrapper.dataset.wired) return;
  wrapper.dataset.wired = '1';

  const sandboxBtn = wrapper.querySelector('.theatre-sandbox-btn') as HTMLElement;
  if (!sandboxBtn) return;

  // Remove native title — dropdown replaces it
  sandboxBtn.removeAttribute('title');

  // Check initial status and show button if Lima is available
  window.api.lima.status(path).then((status) => {
    if (!status.available) return;
    wrapper.style.display = 'flex';
    sandboxBtn.classList.toggle('theatre-sandbox-btn--active', status.vmStatus === 'Running');
  });

  // Click handler opens/closes dropdown
  sandboxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSandboxDropdown(wrapper, path);
  });
}

/**
 * Toggle sandbox dropdown visibility
 */
function toggleSandboxDropdown(wrapper: HTMLElement, path: string): void {
  if (sandboxDropdownVisible.value) {
    hideSandboxDropdown();
  } else {
    showSandboxDropdown(wrapper, path);
  }
}

/**
 * Show the sandbox dropdown
 */
async function showSandboxDropdown(wrapper: HTMLElement, path: string): Promise<void> {
  if (sandboxDropdownVisible.value) return;

  // Create dropdown
  let dropdown = wrapper.querySelector('.sandbox-dropdown') as HTMLElement;
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'sandbox-dropdown';
    wrapper.appendChild(dropdown);
  }

  await buildSandboxDropdownContent(dropdown, wrapper, path);

  requestAnimationFrame(() => {
    dropdown.classList.add('visible');
  });

  sandboxDropdownVisible.value = true;

  // Click outside handler — use capture phase and skip clicks from the
  // same event loop tick (the click that opened the dropdown) by recording
  // the opening timestamp.
  const openedAt = Date.now();
  const handleClickOutside = (e: MouseEvent) => {
    if (Date.now() - openedAt < 50) return; // Ignore the opening click
    const target = e.target as HTMLElement;
    if (!target.closest('.theatre-sandbox-wrapper')) {
      hideSandboxDropdown();
    }
  };

  document.addEventListener('click', handleClickOutside);

  theatreState.sandboxDropdownCleanup = () => {
    document.removeEventListener('click', handleClickOutside);
  };
}

/**
 * Hide the sandbox dropdown
 */
export function hideSandboxDropdown(): void {
  if (!sandboxDropdownVisible.value) return;

  const dropdown = document.querySelector('.sandbox-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
    setTimeout(() => dropdown.remove(), 150);
  }

  if (theatreState.sandboxDropdownCleanup) {
    theatreState.sandboxDropdownCleanup();
    theatreState.sandboxDropdownCleanup = null;
  }

  sandboxDropdownVisible.value = false;
}

/** Active border animation SVG — stored so cleanup is reliable */
let activeBorderAnim: SVGElement | null = null;

/**
 * Add or remove the animated SVG border on the sandbox button.
 * Creates an SVG rect overlay sized to the button with a dashed stroke
 * that traces around the border while the VM is starting up.
 */
export function setSandboxButtonStarting(starting: boolean): void {
  const btn = document.querySelector('.theatre-sandbox-btn') as HTMLElement | null;

  if (!btn) return;

  if (starting) {
    // Remove any stale animation first
    if (activeBorderAnim) {
      activeBorderAnim.remove();
      activeBorderAnim = null;
    }
    btn.classList.add('theatre-sandbox-btn--starting');
    const w = btn.offsetWidth + 4;
    const h = btn.offsetHeight + 4;
    const r = (parseFloat(getComputedStyle(btn).borderRadius) || 6) + 2;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('sandbox-border-anim');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', '0.5');
    rect.setAttribute('y', '0.5');
    rect.setAttribute('width', String(w - 1));
    rect.setAttribute('height', String(h - 1));
    rect.setAttribute('rx', String(r - 0.5));
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#0A84FF');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('pathLength', '100');
    rect.setAttribute('stroke-dasharray', '25 75');
    rect.setAttribute('stroke-linecap', 'round');
    svg.appendChild(rect);
    btn.appendChild(svg);
    activeBorderAnim = svg;

  } else {
    btn.classList.remove('theatre-sandbox-btn--starting');

    if (activeBorderAnim) {
      activeBorderAnim.remove();
      activeBorderAnim = null;
    }
    // Belt-and-suspenders: remove any orphaned animation SVGs
    btn.querySelectorAll('.sandbox-border-anim').forEach(el => el.remove());
  }
}

/**
 * Query Lima VM status and update the sandbox button appearance.
 * Always clears the starting animation first, then sets active/inactive
 * based on actual VM status.
 */
export async function refreshSandboxButton(path: string): Promise<void> {

  // Clear animation immediately — don't wait for the status query
  setSandboxButtonStarting(false);
  try {
    const status = await window.api.lima.status(path);

    const btn = document.querySelector('.theatre-sandbox-btn');
    if (btn) {
      btn.classList.toggle('theatre-sandbox-btn--active', status.vmStatus === 'Running');
    }
  } catch (error) {
    console.warn('[Lima] refreshSandboxButton failed:', error instanceof Error ? error.message : error);
  }
}

/**
 * Build the sandbox dropdown content
 */
async function buildSandboxDropdownContent(
  dropdown: HTMLElement,
  wrapper: HTMLElement,
  path: string,
): Promise<void> {
  dropdown.innerHTML = '';

  const [status, hooks, config] = await Promise.all([
    window.api.lima.status(path),
    window.api.hooks.get(path),
    window.api.lima.getConfig(path),
  ]);

  const sandboxBtn = wrapper.querySelector('.theatre-sandbox-btn') as HTMLElement;
  const setupHook = hooks['sandbox-setup'];

  // Header
  const header = document.createElement('div');
  header.className = 'sandbox-dropdown-header';
  header.textContent = 'Lima Sandbox';
  dropdown.appendChild(header);

  // Detail rows container
  const detailsContainer = document.createElement('div');
  detailsContainer.className = 'sandbox-dropdown-details';
  dropdown.appendChild(detailsContainer);

  const vmStatusMap: Record<string, string> = {
    'Running': 'Running',
    'Stopped': 'Stopped',
    'Broken': 'Broken',
    'NotCreated': 'Not created',
    'Unavailable': 'Unavailable',
  };

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${Math.round(value * 10) / 10} ${units[i]}`;
  }

  function createSelect(options: number[], selected: number, suffix: string): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'sandbox-dropdown-select';
    for (const val of options) {
      const opt = document.createElement('option');
      opt.value = String(val);
      opt.textContent = `${val} ${suffix}`;
      if (val === selected) opt.selected = true;
      select.appendChild(opt);
    }
    return select;
  }

  function updateDetailRows(s: { vmStatus: string; instanceName?: string; memory?: number; disk?: number }) {
    detailsContainer.innerHTML = '';

    // VM row
    const vmRow = document.createElement('div');
    vmRow.className = 'sandbox-dropdown-detail-row';

    const vmLabel = document.createElement('span');
    vmLabel.className = 'sandbox-dropdown-detail-label';
    vmLabel.textContent = 'VM';
    vmRow.appendChild(vmLabel);

    const vmValue = document.createElement('span');
    vmValue.className = 'sandbox-dropdown-detail-value';
    if (s.vmStatus === 'Running') vmValue.classList.add('sandbox-dropdown-detail-value--running');
    const vmText = vmStatusMap[s.vmStatus] || s.vmStatus;
    vmValue.textContent = vmText;
    vmRow.appendChild(vmValue);

    detailsContainer.appendChild(vmRow);

    // VM lifecycle hints
    if (s.vmStatus === 'NotCreated') {
      const vmHint = document.createElement('div');
      vmHint.className = 'sandbox-dropdown-vm-hint';
      vmHint.textContent = 'Created automatically when you open a sandbox terminal';
      detailsContainer.appendChild(vmHint);
    } else if (s.vmStatus === 'Stopped') {
      const vmHint = document.createElement('div');
      vmHint.className = 'sandbox-dropdown-vm-hint';
      vmHint.textContent = 'Started automatically when you open a sandbox terminal';
      detailsContainer.appendChild(vmHint);
    } else if (s.vmStatus === 'Broken') {
      const vmHint = document.createElement('div');
      vmHint.className = 'sandbox-dropdown-vm-hint';
      vmHint.textContent = 'VM is in a broken state. Recreate to fix.';
      detailsContainer.appendChild(vmHint);
    } else if (s.vmStatus === 'Running') {
      const vmHint = document.createElement('div');
      vmHint.className = 'sandbox-dropdown-vm-hint';
      vmHint.textContent = 'Stopped automatically when you quit Ouijit';
      detailsContainer.appendChild(vmHint);
    }

    // Instance name row (if available)
    if (s.instanceName) {
      const nameRow = document.createElement('div');
      nameRow.className = 'sandbox-dropdown-detail-row';

      const nameLabel = document.createElement('span');
      nameLabel.className = 'sandbox-dropdown-detail-label';
      nameLabel.textContent = 'Name';
      nameRow.appendChild(nameLabel);

      const nameValue = document.createElement('span');
      nameValue.className = 'sandbox-dropdown-detail-value sandbox-dropdown-detail-value--mono';
      nameValue.textContent = s.instanceName;
      nameRow.appendChild(nameValue);

      detailsContainer.appendChild(nameRow);
    }

    // Memory select row
    const memRow = document.createElement('div');
    memRow.className = 'sandbox-dropdown-detail-row';
    const memLabel = document.createElement('span');
    memLabel.className = 'sandbox-dropdown-detail-label';
    memLabel.textContent = 'Memory';
    memRow.appendChild(memLabel);

    const memSelect = createSelect([2, 4, 8, 16], config.memoryGiB, 'GiB');
    memSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      const val = Number((e.target as HTMLSelectElement).value);
      config.memoryGiB = val;
      window.api.lima.setConfig(path, { memoryGiB: val }).catch((err: unknown) => {
        console.warn('[Lima] Failed to save memory config:', err instanceof Error ? err.message : err);
      });
    });
    memRow.appendChild(memSelect);
    detailsContainer.appendChild(memRow);

    // Disk select row
    const diskRow = document.createElement('div');
    diskRow.className = 'sandbox-dropdown-detail-row';
    const diskLabel = document.createElement('span');
    diskLabel.className = 'sandbox-dropdown-detail-label';
    diskLabel.textContent = 'Disk';
    diskRow.appendChild(diskLabel);

    const diskSelect = createSelect([20, 50, 100, 200], config.diskGiB, 'GiB');
    diskSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      const val = Number((e.target as HTMLSelectElement).value);
      config.diskGiB = val;
      window.api.lima.setConfig(path, { diskGiB: val }).catch((err: unknown) => {
        console.warn('[Lima] Failed to save disk config:', err instanceof Error ? err.message : err);
      });
    });
    diskRow.appendChild(diskSelect);
    detailsContainer.appendChild(diskRow);
  }

  updateDetailRows(status);

  // Action buttons container
  const vmExists = status.vmStatus === 'Running' || status.vmStatus === 'Stopped' || status.vmStatus === 'Broken';

  // Start VM button (when stopped or not created)
  if (status.vmStatus === 'Stopped' || status.vmStatus === 'Broken' || status.vmStatus === 'NotCreated') {
    const startBtn = document.createElement('button');
    startBtn.className = 'sandbox-dropdown-stop-btn';
    startBtn.textContent = 'Start VM';
    startBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideSandboxDropdown();
      sandboxBtn.classList.remove('theatre-sandbox-btn--active');
      setSandboxButtonStarting(true);
      window.api.lima.start(path).catch(() => {});
      // Poll until VM is running (timeout after 5 min)
      const poll = setInterval(async () => {
        try {
          const s = await window.api.lima.status(path);
          if (s.vmStatus === 'Running') {
            clearInterval(poll);
            await refreshSandboxButton(path);
          }
        } catch { /* ignore */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); refreshSandboxButton(path); }, 300_000);
    });
    dropdown.appendChild(startBtn);
  }

  // Stop VM button (only when running)
  if (status.vmStatus === 'Running') {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'sandbox-dropdown-stop-btn';
    stopBtn.textContent = 'Stop VM';
    stopBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping...';
      await window.api.lima.stop(path);
      await refreshSandboxButton(path);
      await buildSandboxDropdownContent(dropdown, wrapper, path);
    });
    dropdown.appendChild(stopBtn);

  }

  // VM Console — open a plain shell in the sandbox (creates/starts VM if needed)
  const consoleBtn = document.createElement('button');
  consoleBtn.className = 'sandbox-dropdown-stop-btn';
  consoleBtn.textContent = 'VM Console';
  consoleBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideSandboxDropdown();
    await theatreRegistry.addTheatreTerminal?.(
      { name: 'VM Console', command: '', source: 'custom', priority: 0 },
      { sandboxed: true },
    );
  });
  dropdown.appendChild(consoleBtn);

  // Recreate VM button (when VM exists)
  if (vmExists) {
    const recreateBtn = document.createElement('button');
    recreateBtn.className = 'sandbox-dropdown-stop-btn';
    recreateBtn.textContent = 'Recreate VM';
    recreateBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      recreateBtn.disabled = true;
      recreateBtn.textContent = 'Recreating...';
      hideSandboxDropdown();
      sandboxBtn.classList.remove('theatre-sandbox-btn--active');
      setSandboxButtonStarting(true);
      // Fire recreate — don't await, the IPC may never resolve
      window.api.lima.recreate(path).catch(() => {});
      // Poll lima status until VM is running (timeout after 5 min)
      const poll = setInterval(async () => {
        try {
          const s = await window.api.lima.status(path);

          if (s.vmStatus === 'Running') {
            clearInterval(poll);
            await refreshSandboxButton(path);
          }
        } catch { /* ignore */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); refreshSandboxButton(path); }, 300_000);
    });
    dropdown.appendChild(recreateBtn);

    // Delete VM button (when stopped or broken, with confirmation)
    if (status.vmStatus === 'Stopped' || status.vmStatus === 'Broken') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'sandbox-dropdown-delete-btn';
      deleteBtn.textContent = 'Delete VM';
      let confirmPending = false;
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirmPending) {
          confirmPending = true;
          deleteBtn.textContent = 'Confirm Delete';
          deleteBtn.classList.add('sandbox-dropdown-delete-btn--confirm');
          return;
        }
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting...';
        await window.api.lima.delete(path);
        await refreshSandboxButton(path);
        await buildSandboxDropdownContent(dropdown, wrapper, path);
      });
      dropdown.appendChild(deleteBtn);
    }
  }

  // Divider
  const divider = document.createElement('div');
  divider.className = 'sandbox-dropdown-divider';
  dropdown.appendChild(divider);

  // Setup hook row
  const hookRow = document.createElement('div');
  hookRow.className = 'sandbox-dropdown-hook-row';

  const hookLabel = document.createElement('span');
  hookLabel.className = 'sandbox-dropdown-detail-label';
  hookLabel.textContent = 'Setup';
  hookRow.appendChild(hookLabel);

  const hookRight = document.createElement('div');
  hookRight.className = 'sandbox-dropdown-hook-right';

  if (setupHook?.command) {
    const commandEl = document.createElement('span');
    commandEl.className = 'sandbox-dropdown-hook-command';
    commandEl.textContent = setupHook.command;
    commandEl.title = setupHook.command;
    hookRight.appendChild(commandEl);

    const editBtn = document.createElement('button');
    editBtn.className = 'sandbox-dropdown-hook-edit';
    editBtn.innerHTML = '<i data-lucide="settings"></i>';
    editBtn.title = 'Edit setup hook';
    editBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideSandboxDropdown();
      const { showHookConfigDialog } = await import('../hookConfigDialog');
      await showHookConfigDialog(path, 'sandbox-setup', setupHook);
    });
    hookRight.appendChild(editBtn);
  } else {
    const configureBtn = document.createElement('button');
    configureBtn.className = 'sandbox-dropdown-hook-configure';
    configureBtn.textContent = '+ Configure';
    configureBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideSandboxDropdown();
      const { showHookConfigDialog } = await import('../hookConfigDialog');
      await showHookConfigDialog(path, 'sandbox-setup', undefined);
    });
    hookRight.appendChild(configureBtn);
  }

  hookRow.appendChild(hookRight);
  dropdown.appendChild(hookRow);

  // Hint
  const hint = document.createElement('div');
  hint.className = 'sandbox-dropdown-hint';
  hint.textContent = 'Runs once per VM session';
  dropdown.appendChild(hint);

  // Render lucide icons in the dropdown
  const { createIcons, icons } = await import('lucide');
  createIcons({ icons, nameAttr: 'data-lucide' });
}
