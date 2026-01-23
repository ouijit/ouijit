/**
 * Theatre mode orchestration - enter/exit, session management
 */

import type { Project, RunConfig, ChangedFile, ActiveSession } from '../../types';
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
  switchToTheatreTerminal,
  selectByStackPosition,
  setupCardActions,
  setupCtrlCLongPress,
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
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes } from '../../utils/hotkeys';

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
      } else if (runConfig) {
        // Create terminal with the requested command
        await addTheatreTerminal(runConfig);
      } else {
        // No command requested - show empty state
        showStackEmptyState();
      }
    }
  }

  // 4. Set up keyboard shortcuts for theatre mode
  pushScope(Scopes.THEATRE);
  registerHotkey('escape', Scopes.THEATRE, () => exitTheatreMode());
  registerHotkey('command+n', Scopes.THEATRE, () => createNewAgentShell());
  registerHotkey('command+t', Scopes.THEATRE, () => toggleTaskIndex());
  registerHotkey('command+i', Scopes.THEATRE, () => addTheatreTerminal());
  registerHotkey('command+p', Scopes.THEATRE, () => theatreRegistry.playOrToggleRunner?.());
  registerHotkey('command+d', Scopes.THEATRE, () => theatreRegistry.toggleActiveDiffPanel?.());

  // ⌘1-9 to select by stack position (terminals or tasks in empty state)
  for (let i = 1; i <= 9; i++) {
    registerHotkey(`command+${i}`, Scopes.THEATRE, () => {
      selectByStackPosition(i);
    });
  }

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
  unregisterHotkey('escape', Scopes.THEATRE);
  unregisterHotkey('command+n', Scopes.THEATRE);
  unregisterHotkey('command+t', Scopes.THEATRE);
  unregisterHotkey('command+i', Scopes.THEATRE);
  unregisterHotkey('command+p', Scopes.THEATRE);
  unregisterHotkey('command+d', Scopes.THEATRE);
  for (let i = 1; i <= 9; i++) {
    unregisterHotkey(`command+${i}`, Scopes.THEATRE);
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
  registerHotkey('escape', Scopes.THEATRE, () => exitTheatreMode());
  registerHotkey('command+n', Scopes.THEATRE, () => createNewAgentShell());
  registerHotkey('command+t', Scopes.THEATRE, () => toggleTaskIndex());
  registerHotkey('command+i', Scopes.THEATRE, () => addTheatreTerminal());
  registerHotkey('command+p', Scopes.THEATRE, () => theatreRegistry.playOrToggleRunner?.());
  registerHotkey('command+d', Scopes.THEATRE, () => theatreRegistry.toggleActiveDiffPanel?.());

  // ⌘1-9 to select by stack position (terminals or tasks in empty state)
  for (let i = 1; i <= 9; i++) {
    registerHotkey(`command+${i}`, Scopes.THEATRE, () => {
      selectByStackPosition(i);
    });
  }

  // 5. Start periodic git status refresh
  if (project.hasGit) {
    theatreState.gitStatusPeriodicInterval = setInterval(() => {
      refreshGitStatus();
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
    // Hide cursor AFTER replay - buffered output may contain cursor-show sequences
    // The running app will show cursor when it redraws after resize
    terminal.write('\x1b[?25l');
  }

  // Set up resize observer
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    window.api.pty.resize(session.ptyId, terminal.cols, terminal.rows);
  });
  resizeObserver.observe(xtermContainer);

  // Trigger resize to sync terminal size and force TUI apps to redraw
  // Use a small delay to ensure the terminal is fully initialized
  setTimeout(() => {
    fitAddon.fit();
    window.api.pty.resize(session.ptyId, terminal.cols, terminal.rows);
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

  // Set up long-press Ctrl+C to close terminal
  setupCtrlCLongPress(theatreTerminal, () => {
    const idx = terminals.value.indexOf(theatreTerminal);
    if (idx !== -1) {
      import('./terminalCards').then(({ closeTheatreTerminal }) => {
        closeTheatreTerminal(idx);
      });
    }
  });

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
