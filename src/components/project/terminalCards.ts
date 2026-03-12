/**
 * Project terminal card management - multi-terminal UI, runner panels, card stack, tags
 *
 * This module contains the remaining UI-level code not absorbed by terminal.ts
 * or terminalManager.ts:
 *   - addProjectTerminal / closeProjectTerminal  (spawn & teardown)
 *   - Runner panel lifecycle  (showRunnerPanel, runDefaultInCard, etc.)
 *   - Card stack positioning  (updateCardStack, pagination)
 *   - Empty state
 *   - Tag input UI
 *   - Terminal reconnection
 *   - Card context menu
 */

import type { PtySpawnOptions, RunConfig, WorktreeInfo, ActiveSession } from '../../types';
import type { SummaryType } from './state';
import { STACK_PAGE_SIZE } from './state';
import { hideRunnerPanel, projectRegistry } from './helpers';
import { projectPath, invalidateTaskList, homeViewActive } from './signals';
import { OuijitTerminal, scrollSafeFit, resolveTerminalLabel, getManager } from '../terminal';
import { showToast } from '../importDialog';
import { showHookConfigDialog } from '../hookConfigDialog';
import { hideTerminalDiffPanel } from './diffPanel';
import { setSandboxButtonStarting, refreshSandboxButton } from './projectMode';
import { addTerminalInHomeView } from '../homeView';
import { convertIconsIn } from '../../utils/icons';
import { escapeHtml } from '../../utils/html';
import { addTooltip, convertTitlesIn } from '../../utils/tooltip';

// Platform detection for shortcuts display
const isMac = navigator.platform.toLowerCase().includes('mac');

// ── Loading card ─────────────────────────────────────────────────────

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

  const manager = getManager();
  const currentTerminals = manager.terminals.value;
  const currentActiveIndex = manager.activeIndex.value;
  const page = manager.activeStackPage.value;
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, currentTerminals.length);

  // Push existing terminals on the current page back by one position
  currentTerminals.forEach((term, index) => {
    term.container.classList.remove(
      'project-card--active',
      'project-card--back-1',
      'project-card--back-2',
      'project-card--back-3',
      'project-card--back-4',
      'project-card--hidden',
    );

    if (index < pageStart || index >= pageEnd) {
      term.container.classList.add('project-card--hidden');
    } else if (index === currentActiveIndex) {
      term.container.classList.add('project-card--back-1');
    } else {
      const diff =
        index < currentActiveIndex
          ? currentActiveIndex - index
          : pageEnd - pageStart - (index - pageStart) + (currentActiveIndex - pageStart);
      const newBackPosition = Math.min(diff + 1, 4);
      term.container.classList.add(`project-card--back-${newBackPosition}`);
    }
  });

  // Create and add loading card as the new active card
  const loadingCard = createLoadingCard(label);
  stack.appendChild(loadingCard);

  // Adjust stack top position
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
}

// ── Card actions ─────────────────────────────────────────────────────

/**
 * Set up card action buttons (runner pill for all terminals, close-task for worktrees)
 */
export function setupCardActions(term: OuijitTerminal): void {
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

  // Tag button
  const tagBtn = labelEl.querySelector('.project-card-tag-btn') as HTMLElement;
  if (tagBtn) {
    tagBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTagInput(term);
    });
  }

  // Runner button
  const runBtn = labelEl.querySelector('.card-tab-run');
  if (runBtn) {
    runBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (term.runner?.ptyId) {
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
async function showCardContextMenu(event: MouseEvent, term: OuijitTerminal): Promise<void> {
  document.querySelector('.task-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';

  // "Open in Terminal"
  if (term.worktreePath && term.worktreeBranch) {
    const terminalItem = document.createElement('button');
    terminalItem.className = 'task-context-menu-item';
    terminalItem.innerHTML = '<i data-icon="terminal"></i> Open in Terminal';
    terminalItem.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      if (homeViewActive.value) {
        addTerminalInHomeView(term.projectPath, {
          worktreePath: term.worktreePath!,
          worktreeBranch: term.worktreeBranch!,
          taskId: term.taskId!,
          sandboxed: false,
        });
      } else {
        addProjectTerminal(undefined, {
          existingWorktree: {
            path: term.worktreePath!,
            branch: term.worktreeBranch!,
            createdAt: '',
          },
          taskId: term.taskId!,
          sandboxed: false,
        });
      }
    });
    menu.appendChild(terminalItem);
  }

  // "Open in Sandbox"
  if (term.worktreePath && term.worktreeBranch && term.projectPath) {
    const limaStatus = await window.api.lima.status(term.projectPath);
    if (limaStatus.available) {
      const sandboxItem = document.createElement('button');
      sandboxItem.className = 'task-context-menu-item';
      sandboxItem.innerHTML = '<i data-icon="cube"></i> Open in Sandbox';
      sandboxItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        if (homeViewActive.value) {
          addTerminalInHomeView(term.projectPath, {
            worktreePath: term.worktreePath!,
            worktreeBranch: term.worktreeBranch!,
            taskId: term.taskId!,
            sandboxed: true,
          });
        } else {
          addProjectTerminal(undefined, {
            existingWorktree: {
              path: term.worktreePath!,
              branch: term.worktreeBranch!,
              createdAt: '',
            },
            taskId: term.taskId!,
            sandboxed: true,
          });
        }
      });
      menu.appendChild(sandboxItem);
    }
  }

  // "Open in Editor"
  if (term.worktreePath && term.projectPath) {
    try {
      const hooks = await window.api.hooks.get(term.projectPath);
      if (hooks.editor) {
        const editorItem = document.createElement('button');
        editorItem.className = 'task-context-menu-item';
        editorItem.innerHTML = '<i data-icon="code"></i> Open in Editor';
        editorItem.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.remove();
          window.api.openInEditor(term.projectPath, term.worktreePath!);
        });
        menu.appendChild(editorItem);
      }
    } catch {
      /* no hooks configured */
    }
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

  const dismiss = (e: MouseEvent) => {
    if (menu.contains(e.target as Node)) return;
    menu.classList.remove('task-context-menu--visible');
    setTimeout(() => menu.remove(), 100);
    document.removeEventListener('mousedown', dismiss);
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

/**
 * Close a task from its terminal card
 */
async function closeTaskFromTerminal(term: OuijitTerminal): Promise<void> {
  if (term.taskId == null) return;

  const result = await window.api.task.setStatus(term.projectPath, term.taskId, 'done');
  if (result.success) {
    closeProjectTerminal(term);
    showToast('Task closed', 'success');
    invalidateTaskList();
  } else {
    showToast(result.error || 'Failed to close task', 'error');
  }
}

// ── Runner panel ─────────────────────────────────────────────────────

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
 */
function setupRunnerResizeHandle(term: OuijitTerminal, handle: HTMLElement, panel: HTMLElement): () => void {
  const cardBody = term.container.querySelector('.project-card-body') as HTMLElement;
  if (!cardBody) return () => {};

  let dragging = false;

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    dragging = true;
    panel.style.transition = 'none';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const rect = cardBody.getBoundingClientRect();
    const handleWidth = handle.offsetWidth;
    const totalWidth = rect.width - handleWidth;
    const mouseX = e.clientX - rect.left;
    let ratio = 1 - mouseX / totalWidth;
    ratio = Math.max(0.15, Math.min(0.85, ratio));
    term.runnerSplitRatio = ratio;
    panel.style.flexBasis = `${ratio * 100}%`;
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
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
export function showRunnerPanel(term: OuijitTerminal): void {
  if (term.runnerPanelOpen || !term.runner?.ptyId) return;

  // Close diff panel if open (mutual exclusivity)
  if (term.diffPanelOpen) {
    hideTerminalDiffPanel(term);
  }

  const cardBody = term.container.querySelector('.project-card-body') as HTMLElement;
  if (!cardBody) return;

  cardBody.classList.add('runner-split');
  cardBody.classList.toggle('runner-full', term.runnerFullWidth);

  let panel = cardBody.querySelector('.runner-panel') as HTMLElement;
  if (!panel) {
    // Create resize handle
    const handle = document.createElement('div');
    handle.className = 'runner-resize-handle';
    const viewport = cardBody.querySelector('.terminal-viewport');
    if (viewport) viewport.after(handle);

    // Create panel
    cardBody.insertAdjacentHTML(
      'beforeend',
      buildRunnerPanelHtml(term.runnerCommand || 'Runner', term.runnerFullWidth),
    );
    panel = cardBody.querySelector('.runner-panel') as HTMLElement;
    if (!panel) return;

    convertIconsIn(panel);
    convertTitlesIn(panel);

    // Wire panel buttons
    const collapseBtn = panel.querySelector('.runner-panel-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideRunnerPanel(term);
      });
    }

    const killBtn = panel.querySelector('.runner-panel-kill');
    if (killBtn) {
      killBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        term.killRunner();
        term.fitAddon.fit();
        window.api.pty.resize(term.ptyId, term.xterm.cols, term.xterm.rows);
      });
    }

    const restartBtn = panel.querySelector('.runner-panel-restart');
    if (restartBtn) {
      restartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        restartRunner(term);
      });
    }

    const splitToggleBtn = panel.querySelector('.runner-panel-split-toggle');
    if (splitToggleBtn) {
      splitToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleRunnerFullWidth(term);
      });
    }

    // Attach runner xterm
    if (term.runner) {
      const xtermContainer = panel.querySelector('.runner-xterm-container') as HTMLElement;
      if (xtermContainer) {
        term.runner.xterm.open(xtermContainer);

        // Enable native drag/drop on the runner terminal
        if (!xtermContainer.dataset.dragDropSetup) {
          xtermContainer.dataset.dragDropSetup = 'true';
          const screen = xtermContainer.querySelector('.xterm-screen');
          const target = screen || xtermContainer;

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
                .map((f) => window.api.getPathForFile(f))
                .filter((p): p is string => !!p)
                .map((p) => (p.includes(' ') ? `"${p}"` : p))
                .join(' ');
              if (paths && term.runner) {
                term.runner.xterm.paste(paths);
              }
            }
          });
        }

        // Set up runner resize observer
        term.setRunnerResizeCleanup(() => {});
        // We use the parent's setRunnerResizeCleanup for the drag handle;
        // for the xterm container resize, we store on a data attribute
        const runnerResizeObserver = new ResizeObserver(() => {
          if (term.runner?.ptyId) {
            scrollSafeFit(term.runner.xterm, term.runner.fitAddon);
            setTimeout(() => {
              if (term.runner?.ptyId) {
                window.api.pty.resize(term.runner.ptyId, term.runner.xterm.cols, term.runner.xterm.rows);
              }
            }, 50);
          }
        });
        runnerResizeObserver.observe(xtermContainer);
        // Store cleanup so killRunner can disconnect
        (xtermContainer as any).__runnerResizeObserver = runnerResizeObserver;
      }
    }

    // Set up resize handle drag
    term.setRunnerResizeCleanup(setupRunnerResizeHandle(term, handle, panel));
  } else {
    // Re-opening existing panel
    const handle = cardBody.querySelector('.runner-resize-handle') as HTMLElement;
    if (handle) handle.style.display = '';
  }

  term.runnerPanelOpen = true;

  const runBtn = term.container.querySelector('.card-tab-run');
  if (runBtn) runBtn.classList.add('card-tab--active');

  if (term.runnerFullWidth) {
    panel.style.transition = 'none';
    panel.classList.add('runner-panel--visible');
    panel.style.flexBasis = '100%';
    requestAnimationFrame(() => {
      panel.style.transition = '';
      if (term.runner?.ptyId) {
        term.runner.fitAddon.fit();
        window.api.pty.resize(term.runner.ptyId, term.runner.xterm.cols, term.runner.xterm.rows);
        term.runner.xterm.focus();
      }
    });
  } else {
    requestAnimationFrame(() => {
      panel.classList.add('runner-panel--visible');
      panel.style.flexBasis = `${term.runnerSplitRatio * 100}%`;
    });
    setTimeout(() => {
      if (term.runner?.ptyId) {
        term.runner.fitAddon.fit();
        window.api.pty.resize(term.runner.ptyId, term.runner.xterm.cols, term.runner.xterm.rows);
        term.runner.xterm.focus();
      }
      term.fitAddon.fit();
      window.api.pty.resize(term.ptyId, term.xterm.cols, term.xterm.rows);
    }, 250);
  }
}

/**
 * Toggle the runner panel visibility
 */
export function toggleRunnerPanel(term: OuijitTerminal): void {
  if (term.runnerPanelOpen) {
    hideRunnerPanel(term);
  } else {
    showRunnerPanel(term);
  }
}

/**
 * Toggle runner panel between full-width and split mode
 */
function toggleRunnerFullWidth(term: OuijitTerminal): void {
  term.runnerFullWidth = !term.runnerFullWidth;

  const panel = term.container.querySelector('.runner-panel') as HTMLElement;
  if (!panel) return;

  panel.style.transition = 'none';

  const cardBody = term.container.querySelector('.project-card-body');
  if (cardBody) cardBody.classList.toggle('runner-full', term.runnerFullWidth);

  const toggleBtn = panel.querySelector('.runner-panel-split-toggle') as HTMLElement;

  if (term.runnerFullWidth) {
    panel.classList.add('runner-panel--full');
    panel.style.flexBasis = '100%';
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i data-icon="split-horizontal"></i>';
      addTooltip(toggleBtn, { text: 'Split view' });
    }
  } else {
    panel.classList.remove('runner-panel--full');
    panel.style.flexBasis = `${term.runnerSplitRatio * 100}%`;
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i data-icon="arrows-out"></i>';
      addTooltip(toggleBtn, { text: 'Full width' });
    }
  }

  if (toggleBtn) convertIconsIn(toggleBtn);

  requestAnimationFrame(() => {
    panel.style.transition = '';
    if (term.runner?.ptyId) {
      term.runner.fitAddon.fit();
      window.api.pty.resize(term.runner.ptyId, term.runner.xterm.cols, term.runner.xterm.rows);
    }
    if (!term.runnerFullWidth) {
      term.fitAddon.fit();
      window.api.pty.resize(term.ptyId, term.xterm.cols, term.xterm.rows);
    }
  });
}

/**
 * Kill any existing terminals or runners that are running the same command.
 */
export function killExistingCommandInstances(command: string): void {
  const manager = getManager();
  const currentTerminals = manager.terminals.value;

  // Kill runners with the same command
  for (const term of currentTerminals) {
    if (term.runnerCommand === command) {
      term.killRunner();
    }
  }

  // Close terminals running the same command (reverse order for index safety)
  for (let i = currentTerminals.length - 1; i >= 0; i--) {
    if (currentTerminals[i].command === command) {
      closeProjectTerminal(currentTerminals[i]);
    }
  }
}

/**
 * Restart the runner — kill current process and re-run the run hook
 */
async function restartRunner(term: OuijitTerminal): Promise<void> {
  const wasFullWidth = term.runnerFullWidth;
  term.killRunner();
  await runDefaultInCard(term);
  term.runnerFullWidth = wasFullWidth;
  showRunnerPanel(term);
}

/**
 * Run the run hook as a hidden runner
 */
export async function runDefaultInCard(term: OuijitTerminal): Promise<void> {
  const path = term.projectPath;
  if (!path) return;

  // Kill existing runner first
  if (term.runner?.ptyId) {
    term.killRunner();
  }

  const [hooks, settings] = await Promise.all([window.api.hooks.get(path), window.api.getProjectSettings(path)]);

  if (!hooks.run) {
    const result = await showHookConfigDialog(path, 'run', undefined, {
      killExistingOnRun: settings.killExistingOnRun,
    });
    if (result?.saved && result.hook) {
      showToast('Run hook configured', 'success');
      await runDefaultInCard(term);
    }
    return;
  }

  const runHook = hooks.run;

  // Kill existing instances with same command
  if (settings.killExistingOnRun !== false) {
    killExistingCommandInstances(runHook.command);
  }

  // Set runner state on parent
  term.runnerCommand = runHook.command;
  term.runnerStatus = 'running';

  // Create runner terminal
  const runner = new OuijitTerminal({
    projectPath: path,
    label: runHook.name,
    isRunner: true,
  });

  // Spawn PTY for the runner
  const cwd = term.worktreePath || path;
  const spawnOptions: PtySpawnOptions = {
    cwd,
    projectPath: path,
    command: runHook.command,
    cols: 80,
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
      ...(term.label.value && { OUIJIT_TASK_NAME: term.label.value }),
      ...(term.taskPrompt && { OUIJIT_TASK_PROMPT: term.taskPrompt }),
    },
  };

  try {
    const result = await window.api.pty.spawn(spawnOptions);

    if (!result.success || !result.ptyId) {
      runner.xterm.writeln(`\x1b[31mFailed to start runner: ${result.error || 'Unknown error'}\x1b[0m`);
      term.runnerStatus = 'error';
      term.updateRunnerPill();
      return;
    }

    // Bind runner with custom data/exit handlers
    runner.bind(result.ptyId, {
      skipSideEffects: true,
      onData: (data) => {
        // Extract OSC title sequences to update runner label
        const oscMatches = data.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
        for (const match of oscMatches) {
          if (match[1]) {
            term.runnerCommand = match[1];
            term.updateRunnerPill();
            const panelTitle = term.container.querySelector('.runner-panel-title');
            if (panelTitle) panelTitle.textContent = match[1];
          }
        }
      },
      onExit: (exitCode) => {
        term.runnerStatus = exitCode === 0 ? 'success' : 'error';
        term.updateRunnerPill();
      },
    });

    term.setRunner(runner);
    term.updateRunnerPill();
  } catch (error) {
    runner.xterm.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    term.runnerStatus = 'error';
    term.updateRunnerPill();
  }
}

/**
 * Play or toggle runner for the active terminal (hotkey handler)
 */
async function playOrToggleRunner(): Promise<void> {
  const manager = getManager();
  const activeTerm = manager.activeTerminal.value;
  if (!activeTerm) return;

  if (activeTerm.runner?.ptyId) {
    toggleRunnerPanel(activeTerm);
  } else {
    await runDefaultInCard(activeTerm);
  }
}

// ── Card stack ───────────────────────────────────────────────────────

/**
 * Update card stack visual positions (page-scoped)
 */
export function updateCardStack(): void {
  const stack = document.querySelector('.project-stack') as HTMLElement;
  if (!stack) return;

  const manager = getManager();
  const currentTerminals = manager.terminals.value;
  const currentActiveIndex = manager.activeIndex.value;
  const page = manager.activeStackPage.value;
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, currentTerminals.length);
  const pageSize = pageEnd - pageStart;

  const backCardCount = Math.max(Math.min(pageSize - 1, 4), 0);
  const tabSpace = backCardCount * 24;
  stack.style.top = `${82 + tabSpace}px`;

  // Calculate back positions
  const backPositions: { index: number; diff: number }[] = [];
  currentTerminals.forEach((term, index) => {
    term.container.classList.remove(
      'project-card--active',
      'project-card--back-1',
      'project-card--back-2',
      'project-card--back-3',
      'project-card--back-4',
      'project-card--hidden',
    );

    if (index < pageStart || index >= pageEnd) {
      term.container.classList.add('project-card--hidden');
    } else if (index === currentActiveIndex) {
      term.container.classList.add('project-card--active');
    } else {
      const diff =
        index < currentActiveIndex
          ? currentActiveIndex - index
          : pageSize - (index - pageStart) + (currentActiveIndex - pageStart);
      const backClass = `project-card--back-${Math.min(diff, 4)}`;
      term.container.classList.add(backClass);
      backPositions.push({ index, diff });
    }
  });

  // Sort by diff descending
  backPositions.sort((a, b) => b.diff - a.diff);

  // Assign shortcuts and toggle runner button visibility
  currentTerminals.forEach((term, index) => {
    const shortcutEl = term.container.querySelector('.project-card-shortcut') as HTMLElement;
    const runnerBtn = term.container.querySelector('.card-tab-run') as HTMLElement;

    if (index < pageStart || index >= pageEnd) {
      if (shortcutEl) shortcutEl.style.display = 'none';
      if (runnerBtn) runnerBtn.style.display = 'none';
    } else if (index === currentActiveIndex) {
      if (shortcutEl) shortcutEl.style.display = 'none';
      if (runnerBtn) runnerBtn.style.display = '';
    } else {
      if (shortcutEl) {
        const stackPosition = backPositions.findIndex((bp) => bp.index === index);
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

  updatePaginationArrows(stack);
}

// ── Pagination ───────────────────────────────────────────────────────

function ensurePaginationRow(): HTMLElement {
  let row = document.querySelector('.project-stack-pagination') as HTMLElement;
  if (row) return row;

  row = document.createElement('div');
  row.className = 'project-stack-pagination';
  row.style.display = 'none';

  const manager = getManager();

  const leftBtn = document.createElement('button');
  leftBtn.className = 'project-stack-page-arrow';
  leftBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  leftBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    manager.navigateStackPage(-1);
  });

  const indicator = document.createElement('span');
  indicator.className = 'project-stack-page-indicator';

  const rightBtn = document.createElement('button');
  rightBtn.className = 'project-stack-page-arrow';
  rightBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  rightBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    manager.navigateStackPage(1);
  });

  row.appendChild(leftBtn);
  row.appendChild(indicator);
  row.appendChild(rightBtn);
  document.body.appendChild(row);
  return row;
}

function updatePaginationArrows(_stack: HTMLElement): void {
  const manager = getManager();
  const pages = manager.totalStackPages.value;
  const page = manager.activeStackPage.value;

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

// ── Empty state ──────────────────────────────────────────────────────

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

export function showStackEmptyState(): void {
  const stack = document.querySelector('.project-stack');
  if (!stack) return;

  let emptyState = stack.querySelector('.project-stack-empty') as HTMLElement;
  if (emptyState) {
    requestAnimationFrame(() => {
      emptyState.classList.add('project-stack-empty--visible');
    });
    return;
  }

  stack.insertAdjacentHTML('beforeend', buildEmptyStateHtml());
  emptyState = stack.querySelector('.project-stack-empty') as HTMLElement;

  requestAnimationFrame(() => {
    emptyState.classList.add('project-stack-empty--visible');
  });
}

export function hideStackEmptyState(): void {
  const emptyState = document.querySelector('.project-stack-empty') as HTMLElement;
  if (!emptyState) return;

  emptyState.classList.remove('project-stack-empty--visible');
  setTimeout(() => {
    emptyState.remove();
  }, 200);
}

// ── Add / close project terminals ────────────────────────────────────

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
  skipAutoHook?: boolean;
  background?: boolean;
}

/**
 * Add a new project terminal
 */
export async function addProjectTerminal(runConfig?: RunConfig, options?: AddProjectTerminalOptions): Promise<boolean> {
  const currentProjectPath = projectPath.value;
  if (!currentProjectPath) return false;

  const stack = document.querySelector('.project-stack');
  if (!stack) return false;

  const manager = getManager();

  let terminalCwd = currentProjectPath;
  let worktreeInfo: (WorktreeInfo & { prompt?: string }) | undefined = options?.existingWorktree;
  let loadingCard: HTMLElement | null = null;
  let taskPrompt: string | undefined = options?.existingWorktree?.prompt;

  // Show loading card if creating a new worktree
  if (options?.useWorktree && !worktreeInfo) {
    const loadingLabel = options.worktreeName || 'New task';

    const emptyState = stack.querySelector('.project-stack-empty') as HTMLElement;
    if (emptyState) {
      emptyState.classList.remove('project-stack-empty--visible');
    }

    loadingCard = showLoadingCardInStack(loadingLabel);

    const result = await window.api.task.createAndStart(
      currentProjectPath,
      options.worktreeName,
      options.worktreePrompt,
      options.worktreeBranchName,
    );
    if (!result.success || !result.task || !result.worktreePath) {
      removeLoadingCard(loadingCard);
      updateCardStack();
      if (manager.terminals.value.length === 0 && emptyState) {
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
    if (options?.sandboxed !== undefined) {
      await window.api.task.setSandboxed(currentProjectPath, result.task.taskNumber, options.sandboxed);
    }
    if (!options) options = {};
    options.taskId = result.task.taskNumber;
    invalidateTaskList();
  }

  if (worktreeInfo) {
    terminalCwd = worktreeInfo.path;
  }

  // Look up current task name
  let taskName: string | undefined;
  if (options?.taskId != null) {
    const task = await window.api.task.getByNumber(currentProjectPath, options.taskId);
    taskName = task?.name;
  }

  const label = resolveTerminalLabel(taskName, worktreeInfo?.branch, runConfig?.name);
  const command = runConfig?.command;

  if (loadingCard) {
    removeLoadingCard(loadingCard);
  }

  // Determine command to run
  let startCommand = command;
  let startEnv: Record<string, string> | undefined;

  if (worktreeInfo) {
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

    if (!runConfig && !options?.skipAutoHook) {
      const hooks = await window.api.hooks.get(currentProjectPath);
      const hook = isNewTask ? hooks.start : hooks.continue;
      if (hook) {
        startCommand = hook.command;
      }
    }
  }

  // Check sandbox
  const limaStatus = await window.api.lima.status(currentProjectPath);
  const taskSandboxed = options?.sandboxed ?? options?.existingWorktree?.sandboxed;
  const useSandbox = limaStatus.available && taskSandboxed === true;

  // Create OuijitTerminal
  const term = new OuijitTerminal({
    projectPath: currentProjectPath,
    command: startCommand,
    label,
    sandboxed: useSandbox,
    taskId: options?.taskId ?? null,
    taskPrompt,
    worktreePath: worktreeInfo?.path,
    worktreeBranch: worktreeInfo?.branch,
  });

  stack.appendChild(term.container);
  term.openTerminal();

  await new Promise((resolve) => requestAnimationFrame(resolve));
  term.fitAddon.fit();

  // For sandbox: add to manager early (before spawn)
  const addedEarly = !loadingCard && useSandbox;
  if (addedEarly) {
    setupCardActions(term);
    manager.add(term);
    if (!options?.background) {
      manager.activateLast();
      term.xterm.focus();
    }
  }

  // Spawn PTY
  const spawnOptions: PtySpawnOptions = {
    cwd: terminalCwd,
    projectPath: currentProjectPath,
    command: startCommand,
    cols: term.xterm.cols,
    rows: term.xterm.rows,
    label,
    taskId: options?.taskId,
    worktreePath: worktreeInfo?.path,
    env: startEnv,
    sandboxed: useSandbox,
  };

  try {
    if (useSandbox) setSandboxButtonStarting(true);

    const ptyId = await term.spawnPty(spawnOptions);

    if (useSandbox) await refreshSandboxButton(currentProjectPath);

    // If terminal was closed during loading, clean up
    if (addedEarly && !manager.terminals.value.includes(term)) {
      if (ptyId) window.api.pty.kill(ptyId);
      return false;
    }

    if (!ptyId) {
      if (addedEarly) {
        setTimeout(() => manager.remove(term), 10_000);
      } else {
        setTimeout(() => {
          term.container.remove();
          term.xterm.dispose();
        }, 10_000);
      }
      return false;
    }

    // If not added early, add now
    if (!addedEarly) {
      setupCardActions(term);
      manager.add(term);
      if (!options?.background) {
        manager.activateLast();
        term.xterm.focus();
      }
    }

    // Fetch initial git status and tags
    term.refreshGitStatus();
    term.loadTags();

    return true;
  } catch (error) {
    if (useSandbox) setSandboxButtonStarting(false);
    term.xterm.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    if (addedEarly) {
      manager.remove(term);
    } else {
      term.container.remove();
      term.xterm.dispose();
    }
    return false;
  }
}

/**
 * Close a project terminal (by reference or index)
 */
export function closeProjectTerminal(termOrIndex: OuijitTerminal | number): void {
  const manager = getManager();
  let term: OuijitTerminal | undefined;

  if (typeof termOrIndex === 'number') {
    term = manager.terminals.value[termOrIndex];
  } else {
    term = termOrIndex;
  }
  if (!term) return;

  collapseTagInput(term);
  manager.remove(term);
}

// ── Terminal reconnection ────────────────────────────────────────────

/**
 * Reconnect to an existing PTY session and create an OuijitTerminal for it.
 * Returns a terminal with data forwarding wired. Callers add their own
 * exit handlers and register with the manager.
 */
export async function reconnectTerminal(
  session: ActiveSession,
  container: HTMLElement,
  opts: { worktreeBranch?: string; initialStatus?: SummaryType } = {},
): Promise<OuijitTerminal | null> {
  const term = new OuijitTerminal({
    ptyId: session.ptyId,
    projectPath: session.projectPath,
    command: session.command,
    label: session.label,
    sandboxed: !!session.sandboxed,
    taskId: session.taskId ?? null,
    worktreePath: session.worktreePath,
    worktreeBranch: opts.worktreeBranch,
    initialSummaryType: opts.initialStatus,
  });

  container.appendChild(term.container);
  term.openTerminal();

  await new Promise((resolve) => requestAnimationFrame(resolve));
  term.fitAddon.fit();

  // Reconnect to existing PTY
  const result = await window.api.pty.reconnect(session.ptyId);
  if (!result.success) {
    term.container.remove();
    term.xterm.dispose();
    return null;
  }

  // Replay buffered output
  term.replayBuffer(result.bufferedOutput, result.lastCols, result.isAltScreen);

  // Bind to PTY (wires data, input, exit, resize)
  term.bind(session.ptyId);

  // Force SIGWINCH
  term.forceSigwinch();

  // Load tags and git status
  term.loadTags();
  term.refreshGitStatus();

  return term;
}

// ── Tag input ────────────────────────────────────────────────────────

/** Collect unique tags from all active terminal sessions */
function getActiveSessionTags(): { name: string }[] {
  const seen = new Map<string, string>();
  const manager = getManager();

  // Tags from active terminals
  for (const term of manager.terminals.value) {
    for (const tag of term.tags.value) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }

  // Tags from preserved sessions
  for (const [, session] of manager.sessions) {
    for (const term of session.terminals) {
      for (const tag of term.tags.value) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) seen.set(key, tag);
      }
    }
  }

  return Array.from(seen.values()).map((name) => ({ name }));
}

function toggleTagInput(term: OuijitTerminal): void {
  const tagsRow = term.container.querySelector('.project-card-tags-row') as HTMLElement;
  if (!tagsRow) return;

  if (tagsRow.querySelector('.tag-input-container')) {
    collapseTagInput(term);
  } else {
    expandTagInput(term);
  }
}

function expandTagInput(term: OuijitTerminal): void {
  const tagsRow = term.container.querySelector('.project-card-tags-row') as HTMLElement;
  if (!tagsRow || tagsRow.querySelector('.tag-input-container')) return;

  const container = document.createElement('div');
  container.className = 'tag-input-container';

  // Render existing tags as removable chips
  for (const t of term.tags.value) {
    container.appendChild(createTagChip(t, term));
  }

  // Text input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input-field';
  input.placeholder = term.tags.value.length ? '' : 'Add tag…';
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
      const existing = new Set(term.tags.value.map((t) => t.toLowerCase()));
      const matches = allTags
        .filter((t) => t.name.toLowerCase().includes(value.toLowerCase()) && !existing.has(t.name.toLowerCase()))
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
          e.preventDefault();
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
    } else if (e.key === 'Backspace' && !input.value && term.tags.value.length > 0) {
      e.preventDefault();
      const lastTag = term.tags.value[term.tags.value.length - 1];
      removeTag(term, lastTag, container);
    }
  });

  // Click outside to collapse
  const tagBtn = term.container.querySelector('.project-card-tag-btn');
  const onClickOutside = (e: MouseEvent) => {
    if (!container.contains(e.target as Node) && !tagBtn?.contains(e.target as Node)) {
      collapseTagInput(term);
      document.removeEventListener('mousedown', onClickOutside);
    }
  };
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', onClickOutside);
  });

  (container as any)._cleanupClickOutside = onClickOutside;
}

export function collapseTagInput(term: OuijitTerminal): void {
  const tagsRow = term.container.querySelector('.project-card-tags-row') as HTMLElement;
  if (!tagsRow) return;

  const container = tagsRow.querySelector('.tag-input-container');
  if (!container) return;

  const cleanup = (container as any)._cleanupClickOutside;
  if (cleanup) document.removeEventListener('mousedown', cleanup);

  container.remove();
  delete tagsRow.dataset.lastHtml;
  // Signal effect on terminal will auto-update tag pills
}

function createTagChip(tagName: string, term: OuijitTerminal): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.innerHTML = `${escapeHtml(tagName)}<button class="tag-chip-remove">&times;</button>`;

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

async function addTag(
  term: OuijitTerminal,
  tagName: string,
  container: HTMLElement,
  input: HTMLInputElement,
): Promise<void> {
  const normalized = tagName.trim();
  if (!normalized) return;

  // Same tag already — no-op
  if (term.tags.value.length === 1 && term.tags.value[0].toLowerCase() === normalized.toLowerCase()) {
    input.value = '';
    const dropdown = container.querySelector('.tag-autocomplete-dropdown') as HTMLElement;
    if (dropdown) dropdown.style.display = 'none';
    return;
  }

  // Single tag only — replace existing
  if (term.taskId != null) {
    try {
      await window.api.tags.setTaskTags(term.projectPath, term.taskId, [normalized]);
    } catch {
      /* DB not ready or task gone */
    }
  }
  term.tags.value = [normalized];

  // Replace all chips with the new one
  container.querySelectorAll('.tag-chip').forEach((c) => c.remove());
  const chip = createTagChip(normalized, term);
  container.insertBefore(chip, input);

  input.value = '';
  input.placeholder = '';
  const dropdown = container.querySelector('.tag-autocomplete-dropdown') as HTMLElement;
  if (dropdown) dropdown.style.display = 'none';
}

async function removeTag(term: OuijitTerminal, tagName: string, container: HTMLElement): Promise<void> {
  if (term.taskId != null) {
    try {
      await window.api.tags.removeFromTask(term.projectPath, term.taskId, tagName);
    } catch {
      /* DB not ready or task gone */
    }
  }
  term.tags.value = term.tags.value.filter((t) => t.toLowerCase() !== tagName.toLowerCase());

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
  if (input && term.tags.value.length === 0) {
    input.placeholder = 'Add tag…';
  }
}

// ── Registry registration ────────────────────────────────────────────

projectRegistry.addProjectTerminal = addProjectTerminal;
projectRegistry.closeProjectTerminal = closeProjectTerminal;
projectRegistry.playOrToggleRunner = playOrToggleRunner;
