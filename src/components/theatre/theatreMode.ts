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
  runDefaultCommand,
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

    // Wire up play button (runs default command)
    const playBtn = headerContent.querySelector('.theatre-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await runDefaultCommand();
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

    // Wire up terminal button (opens new shell)
    const terminalBtn = headerContent.querySelector('.theatre-terminal-btn');
    if (terminalBtn) {
      terminalBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await addTheatreTerminal();
      });
    }

    // Wire up sandbox toggle button
    const sandboxBtn = headerContent.querySelector('.theatre-sandbox-btn') as HTMLElement;
    if (sandboxBtn) {
      wireSandboxButton(sandboxBtn, path);
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

    // Wire up play button
    const playBtn = headerContent.querySelector('.theatre-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await runDefaultCommand();
      });
    }

    // Wire up chevron button
    const chevronBtn = headerContent.querySelector('.theatre-launch-chevron-btn');
    if (chevronBtn) {
      chevronBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLaunchDropdown();
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

    // Wire up sandbox toggle button
    const sandboxBtn = headerContent.querySelector('.theatre-sandbox-btn') as HTMLElement;
    if (sandboxBtn) {
      wireSandboxButton(sandboxBtn, path);
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

    // First reconnect main terminals
    for (const session of mainSessions) {
      await reconnectTheatreTerminal(session);
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
async function reconnectTheatreTerminal(session: ActiveSession): Promise<void> {
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
    isWorktree: session.isWorktree,
    worktreePath: session.worktreePath,
    worktreeBranch: session.worktreeBranch,
    gitStatus: null,
    diffPanelOpen: false,
    diffPanelFiles: [],
    diffPanelSelectedFile: null,
    diffPanelMode: session.isWorktree ? 'worktree' : 'uncommitted',
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
 * Wire up the sandbox toggle button with click handler and hover tooltip
 */
function wireSandboxButton(sandboxBtn: HTMLElement, path: string): void {
  let tooltip: HTMLElement | null = null;
  let showTimeout: ReturnType<typeof setTimeout> | null = null;
  let hovered = false;

  // Remove native title — we use a custom tooltip
  sandboxBtn.removeAttribute('title');

  // Check initial status
  window.api.lima.status(path).then((status) => {
    if (!status.available) return;
    sandboxBtn.style.display = 'flex';
    if (status.enabled) {
      sandboxBtn.classList.add('theatre-sandbox-btn--active');
    }
  });

  // Click handler
  sandboxBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const status = await window.api.lima.status(path);
    if (status.enabled) {
      await window.api.lima.disable(path);
      sandboxBtn.classList.remove('theatre-sandbox-btn--active');
    } else {
      await window.api.lima.enable(path);
      sandboxBtn.classList.add('theatre-sandbox-btn--active');
    }
    // Update tooltip if visible
    if (tooltip?.classList.contains('sandbox-tooltip--visible')) {
      const newStatus = await window.api.lima.status(path);
      updateSandboxTooltip(tooltip, newStatus);
    }
  });

  // Hover tooltip
  sandboxBtn.addEventListener('mouseenter', () => {
    hovered = true;
    showTimeout = setTimeout(async () => {
      if (!hovered) return;
      const status = await window.api.lima.status(path);
      if (!hovered) return;

      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'sandbox-tooltip';
        sandboxBtn.appendChild(tooltip);
      }
      updateSandboxTooltip(tooltip, status);
      requestAnimationFrame(() => {
        tooltip?.classList.add('sandbox-tooltip--visible');
      });
    }, 400);
  });

  sandboxBtn.addEventListener('mouseleave', () => {
    hovered = false;
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
    if (tooltip) {
      tooltip.classList.remove('sandbox-tooltip--visible');
    }
  });
}

/**
 * Update the sandbox tooltip content with current status
 */
function updateSandboxTooltip(
  tooltip: HTMLElement,
  status: { available: boolean; enabled: boolean; vmStatus: string; instanceName?: string },
): void {
  const enabledText = status.enabled ? 'Enabled' : 'Disabled';
  const dotClass = status.enabled ? 'sandbox-tooltip-dot--on' : 'sandbox-tooltip-dot--off';

  // Friendly VM status text
  const vmStatusMap: Record<string, string> = {
    'Running': 'Running',
    'Stopped': 'Stopped',
    'NotCreated': 'Not created',
    'Unavailable': 'Unavailable',
  };
  const vmText = vmStatusMap[status.vmStatus] || status.vmStatus;

  const instanceHtml = status.instanceName
    ? `<div class="sandbox-tooltip-detail">
        <span class="sandbox-tooltip-label">Instance</span>
        <span class="sandbox-tooltip-value">${status.instanceName}</span>
      </div>`
    : '';

  const hintText = status.enabled
    ? 'Click to disable. New terminals will run natively.'
    : 'Click to enable. New terminals will run in an isolated Linux VM.';

  tooltip.innerHTML = `
    <div class="sandbox-tooltip-header">Lima Sandbox</div>
    <div class="sandbox-tooltip-status">
      <span class="sandbox-tooltip-dot ${dotClass}"></span>
      <span class="sandbox-tooltip-status-text">${enabledText}</span>
    </div>
    <div class="sandbox-tooltip-detail">
      <span class="sandbox-tooltip-label">VM</span>
      <span class="sandbox-tooltip-value">${vmText}</span>
    </div>
    ${instanceHtml}
    <div class="sandbox-tooltip-hint">${hintText}</div>
  `;
}
