/**
 * Theatre terminal card management - multi-terminal UI, output analysis, card stack
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { PtyId, PtySpawnOptions, RunConfig, WorktreeInfo } from '../../types';
import {
  TheatreTerminal,
  SummaryType,
  MAX_THEATRE_TERMINALS,
  theatreState,
} from './state';
import { getTerminalGitPath, hideRunnerPanel, theatreRegistry, showTaskContextMenu } from './helpers';
import {
  projectPath,
  projectData,
  terminals,
  activeIndex,
  invalidateTaskList,
} from './signals';
import { showToast } from '../importDialog';
import { showHookConfigDialog } from '../hookConfigDialog';
import { refreshTerminalGitStatus, buildCardGitBranchHtml, buildCardGitStatsHtml, scheduleTerminalGitStatusRefresh } from './gitStatus';
import { toggleTerminalDiffPanel, hideTerminalDiffPanel } from './diffPanel';
import { showShipItPanel } from './shipItPanel';

// Platform detection for shortcuts display
const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * Set up custom key handler for a terminal to let app hotkeys pass through.
 * Without this, xterm captures all keys and our hotkeys-js handlers never fire.
 */
export function setupTerminalAppHotkeys(terminal: Terminal): void {
  terminal.attachCustomKeyEventHandler((event) => {
    // Check for the platform-appropriate modifier
    const hasModifier = isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

    if (hasModifier && !event.altKey) {
      const key = event.key.toLowerCase();
      // App hotkeys that should pass through to hotkeys-js
      const appHotkeys = ['n', 't', 'i', 'p', 'd', 's', 'w', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      if (appHotkeys.includes(key)) {
        return false; // Don't handle - let it bubble up to app
      }
    }

    return true; // Let xterm handle all other keys (including Escape for TUIs)
  });
}

// Track pending resize timeouts per PTY (debounce rapid resize events)
const pendingResizes = new Map<PtyId, ReturnType<typeof setTimeout>>();

/**
 * Debounced resize handler to avoid rapid SIGWINCH signals that cause
 * text wrapping artifacts in shells like zsh during panel animations.
 */
export function debouncedResize(ptyId: PtyId, terminal: Terminal, fitAddon: FitAddon): void {
  // Clear any pending resize for this terminal
  const pending = pendingResizes.get(ptyId);
  if (pending) {
    clearTimeout(pending);
  }

  // Fit immediately (updates xterm.js display)
  fitAddon.fit();

  // Debounce the PTY resize signal (50ms delay for animation settling)
  pendingResizes.set(ptyId, setTimeout(() => {
    pendingResizes.delete(ptyId);
    window.api.pty.resize(ptyId, terminal.cols, terminal.rows);
  }, 50));
}

/**
 * Format a branch name for display (hyphens to spaces)
 */
function formatBranchNameForDisplay(branch: string): string {
  // Check if it's an old-style agent-timestamp branch
  const agentMatch = branch.match(/^agent-(\d+)$/);
  if (agentMatch) {
    const timestamp = parseInt(agentMatch[1], 10);
    const date = new Date(timestamp);
    return `Untitled ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  // Check if it's a named branch with timestamp suffix
  const namedMatch = branch.match(/^(.+)-\d{10,}$/);
  if (namedMatch) {
    return namedMatch[1].replace(/-/g, ' ');
  }

  // Fallback: just replace hyphens with spaces
  return branch.replace(/-/g, ' ');
}

// Track pending summary updates (debounced)
const pendingSummaryUpdates = new Map<PtyId, ReturnType<typeof setTimeout>>();

/**
 * Get terminal color theme (dark theme for terminal containers)
 */
export function getTerminalTheme(): Record<string, string> {
  return {
    background: '#1a1a1a',
    foreground: '#e4e4e4',
    cursor: '#e4e4e4',
    cursorAccent: '#1a1a1a',
    selectionBackground: 'rgba(255, 255, 255, 0.15)',
    black: '#1a1a1a',
    red: '#ff6b6b',
    green: '#69db7c',
    yellow: '#ffd43b',
    blue: '#74c0fc',
    magenta: '#da77f2',
    cyan: '#66d9e8',
    white: '#e4e4e4',
    brightBlack: '#5c5c5c',
    brightRed: '#ff8787',
    brightGreen: '#8ce99a',
    brightYellow: '#ffe066',
    brightBlue: '#a5d8ff',
    brightMagenta: '#e599f7',
    brightCyan: '#99e9f2',
    brightWhite: '#ffffff',
  };
}

/**
 * Strip ANSI escape codes from terminal output for pattern matching
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Analyze terminal output buffer and determine summary state
 */
export function analyzeTerminalOutput(buffer: string, lastOscTitle: string): { summary: string; type: SummaryType } {
  const clean = stripAnsi(buffer);
  const lines = clean.split('\n').filter(l => l.trim());
  const lastLine = lines[lines.length - 1]?.trim() || '';
  const lastFewLines = lines.slice(-5).join('\n');
  const recentText = lines.slice(-20).join('\n');

  // Shell prompt patterns - if we see these at the end, the command has finished
  const shellPromptPatterns = [
    /[$%#❯➜→]\s*$/, // Common prompt endings
    /\w+@\w+.*[$#]\s*$/, // user@host patterns
  ];

  // Claude/AI agent waiting for input patterns
  const agentWaitingPatterns = [
    /^>\s*$/, // Claude's input prompt
    /claude.*>\s*$/i, // claude> prompt
    /\(y\/n\)/i, // Yes/no prompts
  ];

  const isAtPrompt = shellPromptPatterns.some(p => p.test(lastLine));
  const isAgentWaiting = agentWaitingPatterns.some(p => p.test(lastLine));

  // Check if the last OSC title contains spinner characters (Claude thinking indicator)
  // Only braille dots are actual spinners - stars (✻✽✶✳) are static decorations
  const spinnerChars = /[⠁⠂⠄⠈⠐⠠⡀⢀⠃⠅⠆⠉⠊⠌⠑⠒⠔⠘⠡⠢⠤⠨⠰⡁⡂⡄⡈⡐⡠⢁⢂⢄⢈⢐⢠⣀⠇⠋⠍⠎⠓⠕⠖⠙⠚⠜⠣⠥⠦⠩⠪⠬⠱⠲⠴⠸⡃⡅⡆⡉⡊⡌⡑⡒⡔⡘⡡⡢⡤⡨⡰⢃⢅⢆⢉⢊⢌⢑⢒⢔⢘⢡⢢⢤⢨⢰⣁⣂⣄⣈⣐⣠◐◓◑◒]/;

  if (spinnerChars.test(lastOscTitle)) {
    return { summary: '', type: 'thinking' };
  }

  // Completion patterns - build/task finished successfully
  const completionPatterns = [
    /built in \d/i,
    /compiled successfully/i,
    /done in \d/i,
    /finished in \d/i,
  ];

  const justCompleted = completionPatterns.some(p => p.test(lastFewLines));

  // If at shell prompt and we see completion, show completed state
  if (isAtPrompt && justCompleted) {
    return { summary: 'Done', type: 'idle' };
  }

  // If at shell prompt with no special state, show ready
  if (isAtPrompt) {
    return { summary: '', type: 'idle' };
  }

  // If agent is waiting for input, show idle (green = ready for input)
  if (isAgentWaiting) {
    return { summary: '', type: 'idle' };
  }

  // Error patterns - only in recent output
  const errorPatterns = [
    { regex: /\bERROR\b.*?:(.{0,40})/i, extract: true },
    { regex: /\bError\b:(.{0,40})/i, extract: true },
    { regex: /npm ERR!(.{0,30})/i, extract: true },
    { regex: /\bfailed\b/i, extract: false, text: 'Failed' },
    { regex: /ENOENT|EACCES|ECONNREFUSED/, extract: false },
    { regex: /TypeError|ReferenceError|SyntaxError/, extract: false },
  ];

  for (const pattern of errorPatterns) {
    const match = lastFewLines.match(pattern.regex);
    if (match) {
      const summary = pattern.extract && match[1]
        ? match[1].trim().slice(0, 30)
        : pattern.text || match[0].slice(0, 20);
      return { summary: `Error: ${summary}`, type: 'error' };
    }
  }

  // Listening patterns (server is running)
  const listeningPatterns = [
    { regex: /listening on (?:port )?:?(\d+)/i, port: true },
    { regex: /localhost:(\d+)/, port: true },
    { regex: /127\.0\.0\.1:(\d+)/, port: true },
    { regex: /\[::\]:(\d+)/, port: true },
    { regex: /ready on http/i, port: false, text: 'Ready' },
    { regex: /server (?:is )?(?:running|started)/i, port: false, text: 'Running' },
    { regex: /started server/i, port: false, text: 'Started' },
    { regex: /Network:.*http/i, port: false, text: 'Network ready' },
  ];

  for (const pattern of listeningPatterns) {
    const match = recentText.match(pattern.regex);
    if (match) {
      const summary = pattern.port && match[1]
        ? `Listening :${match[1]}`
        : pattern.text || 'Listening';
      return { summary, type: 'listening' };
    }
  }

  // Building/compiling patterns - only if in the last few lines (active)
  const buildingPatterns = [
    /compiling\b/i,
    /building\b/i,
    /bundling\b/i,
    /transforming\b/i,
  ];

  for (const pattern of buildingPatterns) {
    if (pattern.test(lastFewLines)) {
      return { summary: 'Building...', type: 'building' };
    }
  }

  // Watching patterns
  const watchingPatterns = [
    /watching for (?:file )?changes/i,
    /waiting for changes/i,
    /watching\.\.\./i,
    /hot reload/i,
    /hmr enabled/i,
  ];

  for (const pattern of watchingPatterns) {
    if (pattern.test(lastFewLines)) {
      return { summary: 'Watching...', type: 'watching' };
    }
  }

  // Default to idle
  return { summary: '', type: 'idle' };
}

/**
 * Update the terminal card label with current summary state
 */
export function updateTerminalCardLabel(term: TheatreTerminal): void {
  const labelEl = term.container.querySelector('.theatre-card-label');
  if (!labelEl) return;

  // Ensure status dot exists
  let dot = labelEl.querySelector('.theatre-card-status-dot') as HTMLElement;
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'theatre-card-status-dot';
    labelEl.insertBefore(dot, labelEl.firstChild);
  }

  // Update dot color
  dot.setAttribute('data-status', term.summaryType);

  // Update label text
  const labelText = labelEl.querySelector('.theatre-card-label-text');
  if (labelText) {
    // Build display: label — oscTitle — summary (each part optional)
    let display = term.label;
    if (term.lastOscTitle) {
      display += ` — ${term.lastOscTitle}`;
    }
    if (term.summary) {
      display += ` — ${term.summary}`;
    }
    labelText.textContent = display;
  }

  // Update git branch display (second line under label)
  const branchRow = labelEl.querySelector('.theatre-card-git-branch-row') as HTMLElement;
  if (branchRow) {
    const branchHtml = buildCardGitBranchHtml(term.gitStatus);
    if (branchRow.dataset.lastHtml !== branchHtml) {
      branchRow.dataset.lastHtml = branchHtml;
      branchRow.innerHTML = branchHtml;
    }
  }

  // Update git stats display (in label-right)
  const statsWrapper = labelEl.querySelector('.theatre-card-git-stats-wrapper') as HTMLElement;
  if (statsWrapper) {
    const statsHtml = buildCardGitStatsHtml(term.gitStatus);
    if (statsWrapper.dataset.lastHtml !== statsHtml) {
      statsWrapper.dataset.lastHtml = statsHtml;
      statsWrapper.innerHTML = statsHtml;

      const statsEl = statsWrapper.querySelector('.theatre-card-git-stats--clickable') as HTMLElement;
      if (statsEl) {
        statsEl.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleTerminalDiffPanel(term);
        });
      }
    }
  }
}

/**
 * Schedule a throttled summary update for a theatre terminal
 */
export function scheduleTerminalSummaryUpdate(term: TheatreTerminal): void {
  const existing = pendingSummaryUpdates.get(term.ptyId);
  if (existing) clearTimeout(existing);

  pendingSummaryUpdates.set(term.ptyId, setTimeout(() => {
    const { summary, type } = analyzeTerminalOutput(term.outputBuffer, term.lastOscTitle);
    if (summary !== term.summary || type !== term.summaryType) {
      term.summary = summary;
      term.summaryType = type;
      updateTerminalCardLabel(term);
    }
    pendingSummaryUpdates.delete(term.ptyId);
  }, 150));
}

/**
 * Create a theatre terminal card element
 */
export function createTheatreCard(label: string, index: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'theatre-card';
  card.dataset.index = String(index);

  // Card label
  const labelEl = document.createElement('div');
  labelEl.className = 'theatre-card-label';

  labelEl.innerHTML = `
    <div class="theatre-card-label-left">
      <div class="theatre-card-label-top">
        <span class="theatre-card-status-dot" data-status="idle"></span>
        <kbd class="theatre-card-shortcut" style="display: none;"></kbd>
        <span class="theatre-card-label-text">${label}</span>
      </div>
      <div class="theatre-card-git-branch-row"></div>
    </div>
    <div class="theatre-card-label-right">
      <div class="theatre-card-git-stats-wrapper"></div>
      <div class="runner-pill" style="display: none;">
        <button class="runner-pill-play" data-action="run" title="Run default command"><i data-lucide="play"></i></button>
        <div class="runner-pill-status">
          <span class="runner-pill-light"></span>
          <span class="runner-pill-label"></span>
        </div>
      </div>
      <button class="theatre-card-ship-btn theatre-card-action--worktree" style="display: none;" title="Ship changes to main"><i data-lucide="rocket"></i></button>
      <button class="theatre-card-close-task theatre-card-action--worktree" style="display: none;" title="Close task"><i data-lucide="archive"></i></button>
      <button class="theatre-card-close" title="Close terminal"><i data-lucide="x"></i></button>
    </div>
  `;
  card.appendChild(labelEl);

  // Card body - flex container for terminal viewport and diff panel
  const cardBody = document.createElement('div');
  cardBody.className = 'theatre-card-body';

  // Terminal viewport
  const viewport = document.createElement('div');
  viewport.className = 'terminal-viewport';

  const xtermContainer = document.createElement('div');
  xtermContainer.className = 'terminal-xterm-container';
  viewport.appendChild(xtermContainer);

  cardBody.appendChild(viewport);
  card.appendChild(cardBody);

  return card;
}

/**
 * Create a loading placeholder card for task creation
 */
export function createLoadingCard(label: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'theatre-card theatre-card--loading theatre-card--active';

  const labelEl = document.createElement('div');
  labelEl.className = 'theatre-card-label';

  labelEl.innerHTML = `
    <div class="theatre-card-label-left">
      <div class="theatre-card-label-top">
        <span class="theatre-card-status-dot theatre-card-status-dot--loading"></span>
        <span class="theatre-card-label-text">${label || 'New task'}</span>
      </div>
    </div>
    <div class="theatre-card-label-right"></div>
  `;
  card.appendChild(labelEl);

  const cardBody = document.createElement('div');
  cardBody.className = 'theatre-card-body';

  const loadingContent = document.createElement('div');
  loadingContent.className = 'theatre-card-loading-content';
  loadingContent.innerHTML = `
    <div class="theatre-card-loading-text">Setting up workspace...</div>
  `;

  cardBody.appendChild(loadingContent);
  card.appendChild(cardBody);

  return card;
}

/**
 * Show a loading card and push existing terminals back in the stack
 */
export function showLoadingCardInStack(label: string): HTMLElement {
  const stack = document.querySelector('.theatre-stack') as HTMLElement;
  if (!stack) throw new Error('Theatre stack not found');

  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  // Push existing terminals back by one position relative to their current position
  currentTerminals.forEach((term, index) => {
    term.container.classList.remove('theatre-card--active', 'theatre-card--back-1', 'theatre-card--back-2', 'theatre-card--back-3', 'theatre-card--back-4');

    if (index === currentActiveIndex) {
      // Active card becomes back-1
      term.container.classList.add('theatre-card--back-1');
    } else {
      // Calculate current back position and increment it
      const diff = index < currentActiveIndex
        ? currentActiveIndex - index
        : currentTerminals.length - index + currentActiveIndex;
      // Add 1 to push it back further
      const newBackPosition = Math.min(diff + 1, 4);
      term.container.classList.add(`theatre-card--back-${newBackPosition}`);
    }
  });

  // Create and add loading card as the new active card
  const loadingCard = createLoadingCard(label);
  stack.appendChild(loadingCard);

  // Adjust stack top position to account for the loading card + existing cards
  const backCardCount = Math.min(currentTerminals.length, 4);
  const tabSpace = backCardCount * 24;
  stack.style.top = `${82 + tabSpace}px`;

  return loadingCard;
}

/**
 * Remove loading card and restore normal stack positions
 */
export function removeLoadingCard(loadingCard: HTMLElement): void {
  loadingCard.remove();
  // updateCardStack will be called when terminals.value changes
}

/**
 * Set up card action buttons (runner pill for all terminals, close-task for worktrees)
 * Note: Runner pill visibility is controlled by updateCardStack (only shown on active card)
 */
export function setupCardActions(term: TheatreTerminal): void {
  const labelEl = term.container.querySelector('.theatre-card-label');
  if (!labelEl) return;

  // Show worktree-specific buttons for worktree terminals
  if (term.isWorktree && term.worktreeBranch) {
    // Ship button
    const shipBtn = labelEl.querySelector('.theatre-card-ship-btn') as HTMLElement;
    if (shipBtn) {
      shipBtn.style.display = 'flex';
      shipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showShipItPanel(term);
      });
    }

    // Close task button
    const closeBtn = labelEl.querySelector('.theatre-card-close-task') as HTMLElement;
    if (closeBtn) {
      closeBtn.style.display = 'flex';
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await closeTaskFromTerminal(term);
      });
    }
  }

  // Wire up runner pill click handlers
  const runBtn = labelEl.querySelector('.runner-pill-play');
  const pillStatus = labelEl.querySelector('.runner-pill-status');

  if (runBtn) {
    runBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // If runner is already active, toggle the panel instead of starting new run
      if (term.runnerPtyId) {
        toggleRunnerPanel(term);
      } else {
        await runDefaultInCard(term);
      }
    });
  }

  // Clicking the status part of the pill also toggles the panel
  if (pillStatus) {
    pillStatus.addEventListener('click', (e) => {
      e.stopPropagation();
      if (term.runnerPtyId) {
        toggleRunnerPanel(term);
      }
    });
  }
}

/**
 * Update the runner pill appearance based on runner state
 */
export function updateRunnerPill(term: TheatreTerminal): void {
  const pill = term.container.querySelector('.runner-pill') as HTMLElement;
  if (!pill) return;

  const light = pill.querySelector('.runner-pill-light') as HTMLElement;
  const label = pill.querySelector('.runner-pill-label') as HTMLElement;

  if (term.runnerPtyId) {
    // Runner is active - expand the pill
    pill.classList.add('runner-pill--expanded');

    // Update label
    if (label) {
      label.textContent = term.runnerLabel || 'Running...';
    }

    // Update status light
    if (light) {
      light.className = 'runner-pill-light';
      switch (term.runnerStatus) {
        case 'running':
          light.classList.add('runner-pill-light--running');
          break;
        case 'success':
          light.classList.add('runner-pill-light--success');
          break;
        case 'error':
          light.classList.add('runner-pill-light--error');
          break;
        default:
          // idle - no extra class
          break;
      }
    }
  } else {
    // No runner - collapse the pill
    pill.classList.remove('runner-pill--expanded');
  }
}

/**
 * Close a task from its terminal card
 */
async function closeTaskFromTerminal(term: TheatreTerminal): Promise<void> {
  if (!term.isWorktree || !term.worktreeBranch) return;

  const path = projectPath.value;
  if (!path) return;

  const result = await window.api.worktree.close(path, term.worktreeBranch);
  if (result.success) {
    // Close this terminal
    const idx = terminals.value.indexOf(term);
    if (idx !== -1) {
      closeTheatreTerminal(idx);
    }
    // Show warning if cleanup hook failed
    if (result.hookWarning) {
      showToast(`Task closed (cleanup hook failed)`, 'warning');
    } else {
      showToast('Task closed', 'success');
    }
    invalidateTaskList();
  } else {
    showToast(result.error || 'Failed to close task', 'error');
  }
}

/**
 * Build HTML for the runner panel
 */
function buildRunnerPanelHtml(label: string): string {
  return `
    <div class="runner-panel">
      <div class="runner-panel-header">
        <span class="runner-panel-title">${label}</span>
        <button class="runner-panel-kill" title="Kill runner">Kill</button>
        <button class="runner-panel-collapse" title="Collapse panel"><i data-lucide="chevron-right"></i></button>
      </div>
      <div class="runner-panel-body">
        <div class="runner-xterm-container"></div>
      </div>
    </div>
  `;
}

/**
 * Show the runner panel for a terminal
 */
export function showRunnerPanel(term: TheatreTerminal): void {
  if (term.runnerPanelOpen || !term.runnerPtyId) return;

  // Close diff panel if open (mutual exclusivity)
  if (term.diffPanelOpen) {
    hideTerminalDiffPanel(term);
  }

  const cardBody = term.container.querySelector('.theatre-card-body');
  if (!cardBody) return;

  // Check if panel already exists
  let panel = cardBody.querySelector('.runner-panel') as HTMLElement;
  if (!panel) {
    // Create panel (insert at end so it appears on the right)
    cardBody.insertAdjacentHTML('beforeend', buildRunnerPanelHtml(term.runnerCommand || term.runnerLabel || 'Runner'));
    panel = cardBody.querySelector('.runner-panel') as HTMLElement;
    if (!panel) return;

    // Wire up collapse button (hides panel but keeps runner alive)
    const collapseBtn = panel.querySelector('.runner-panel-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideRunnerPanel(term);
      });
    }

    // Wire up kill button (stops runner and removes panel)
    const killBtn = panel.querySelector('.runner-panel-kill');
    if (killBtn) {
      killBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        killRunner(term);
      });
    }

    // Attach xterm if we have a runner terminal
    if (term.runnerTerminal) {
      const xtermContainer = panel.querySelector('.runner-xterm-container') as HTMLElement;
      if (xtermContainer) {
        term.runnerTerminal.open(xtermContainer);

        // Enable native drag/drop on the runner terminal (only once per container)
        if (!xtermContainer.dataset.dragDropSetup) {
          xtermContainer.dataset.dragDropSetup = 'true';
          const setupRunnerDragDrop = (container: HTMLElement, runnerTerm: Terminal) => {
            const screen = container.querySelector('.xterm-screen');
            const target = screen || container;

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
                  .map(f => window.api.getPathForFile(f))
                  .filter((p): p is string => !!p)
                  .map(p => p.includes(' ') ? `"${p}"` : p)
                  .join(' ');
                if (paths) {
                  runnerTerm.paste(paths);
                }
              }
            });
          };
          setupRunnerDragDrop(xtermContainer, term.runnerTerminal);
        }

        if (term.runnerFitAddon) {
          requestAnimationFrame(() => {
            term.runnerFitAddon!.fit();
          });
        }
      }
    }
  }

  // Add class to card
  term.container.classList.add('runner-panel-open');
  term.runnerPanelOpen = true;

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('runner-panel--visible');
  });

  // Refit terminals after animation and focus runner
  setTimeout(() => {
    term.fitAddon.fit();
    window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
    if (term.runnerFitAddon && term.runnerPtyId) {
      term.runnerFitAddon.fit();
      window.api.pty.resize(term.runnerPtyId, term.runnerTerminal!.cols, term.runnerTerminal!.rows);
      term.runnerTerminal!.focus();
    }
  }, 250);
}


/**
 * Toggle the runner panel visibility
 */
export function toggleRunnerPanel(term: TheatreTerminal): void {
  if (term.runnerPanelOpen) {
    hideRunnerPanel(term);
  } else {
    showRunnerPanel(term);
  }
}

/**
 * Kill the runner process and clean up resources
 */
export function killRunner(term: TheatreTerminal): void {
  if (!term.runnerPtyId) return;

  // Hide panel first
  hideRunnerPanel(term);

  // Kill PTY
  window.api.pty.kill(term.runnerPtyId);

  // Clean up listeners
  if (term.runnerCleanupData) term.runnerCleanupData();
  if (term.runnerCleanupExit) term.runnerCleanupExit();

  // Dispose terminal
  if (term.runnerTerminal) {
    term.runnerTerminal.dispose();
  }

  // Remove panel DOM
  const panel = term.container.querySelector('.runner-panel');
  if (panel) {
    panel.remove();
  }

  // Reset state
  term.runnerPtyId = null;
  term.runnerTerminal = null;
  term.runnerFitAddon = null;
  term.runnerLabel = '';
  term.runnerCommand = null;
  term.runnerStatus = 'idle';
  term.runnerCleanupData = null;
  term.runnerCleanupExit = null;

  // Collapse the pill
  updateRunnerPill(term);
}

/**
 * Kill any existing terminals or runners that are running the same command.
 * This ensures only one instance of a command runs at a time.
 */
export function killExistingCommandInstances(command: string): void {
  const currentTerminals = terminals.value;

  // First, kill any runners with the same command
  for (const term of currentTerminals) {
    if (term.runnerCommand === command) {
      killRunner(term);
    }
  }

  // Then, close any terminals running the same command (in reverse order to avoid index issues)
  for (let i = currentTerminals.length - 1; i >= 0; i--) {
    if (currentTerminals[i].command === command) {
      closeTheatreTerminal(i);
    }
  }
}


/**
 * Run the run hook as a hidden runner
 */
export async function runDefaultInCard(term: TheatreTerminal): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  // If runner already active, kill it first
  if (term.runnerPtyId) {
    killRunner(term);
  }

  // Fetch run hook and settings
  const [hooks, settings] = await Promise.all([
    window.api.hooks.get(path),
    window.api.getProjectSettings(path),
  ]);

  if (!hooks.run) {
    // Open config dialog directly when no run hook is set
    const result = await showHookConfigDialog(path, 'run', undefined, {
      killExistingOnRun: settings.killExistingOnRun,
    });
    if (result?.saved && result.hook) {
      showToast('Run script configured', 'success');
      // Run it now that it's configured
      await runDefaultInCard(term);
    }
    return;
  }

  const runHook = hooks.run;

  // Kill any existing terminals or runners with the same command (unless disabled)
  if (settings.killExistingOnRun !== false) {
    killExistingCommandInstances(runHook.command);
  }

  // Set initial runner state
  term.runnerLabel = runHook.name;
  term.runnerCommand = runHook.command;
  term.runnerStatus = 'running';

  // Create hidden terminal for runner output
  const runnerTerminal = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: false,
    cursorStyle: 'bar',
    allowTransparency: false,
    scrollback: 10000,
  });

  const runnerFitAddon = new FitAddon();
  runnerTerminal.loadAddon(runnerFitAddon);

  // Let app hotkeys pass through xterm
  setupTerminalAppHotkeys(runnerTerminal);

  term.runnerTerminal = runnerTerminal;
  term.runnerFitAddon = runnerFitAddon;

  // Spawn PTY for the runner - use worktree path if available, otherwise project path
  const cwd = term.worktreePath || path;
  const spawnOptions: PtySpawnOptions = {
    cwd,
    projectPath: path,  // Use main project path for session grouping during restore
    command: runHook.command,
    cols: 80,  // Default size, will be resized when panel opens
    rows: 24,
    label: runHook.name,
    isWorktree: !!term.isWorktree,
    worktreePath: term.worktreePath,
    worktreeBranch: term.worktreeBranch,
    isRunner: true,
    parentPtyId: term.ptyId,
    env: {
      OUIJIT_HOOK_TYPE: 'run',
      OUIJIT_PROJECT_PATH: path,
      ...(term.worktreePath && { OUIJIT_WORKTREE_PATH: term.worktreePath }),
      ...(term.worktreeBranch && { OUIJIT_TASK_BRANCH: term.worktreeBranch }),
      ...(term.label && { OUIJIT_TASK_NAME: term.label }),
    },
  };

  try {
    const result = await window.api.pty.spawn(spawnOptions);

    if (!result.success || !result.ptyId) {
      runnerTerminal.writeln(`\x1b[31mFailed to start runner: ${result.error || 'Unknown error'}\x1b[0m`);
      term.runnerStatus = 'error';
      updateRunnerPill(term);
      return;
    }

    term.runnerPtyId = result.ptyId;

    // Set up data listener
    term.runnerCleanupData = window.api.pty.onData(result.ptyId, (data) => {
      runnerTerminal.write(data);

      // Extract OSC title sequences to update runner label
      const oscMatches = data.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
      for (const match of oscMatches) {
        if (match[1]) {
          term.runnerLabel = match[1];
          updateRunnerPill(term);
          // Update panel title if visible
          const panelTitle = term.container.querySelector('.runner-panel-title');
          if (panelTitle) {
            panelTitle.textContent = match[1];
          }
        }
      }
    });

    // Set up exit listener
    term.runnerCleanupExit = window.api.pty.onExit(result.ptyId, (exitCode) => {
      runnerTerminal.writeln('');
      const exitColor = exitCode === 0 ? '32' : '31';
      runnerTerminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);

      term.runnerStatus = exitCode === 0 ? 'success' : 'error';
      updateRunnerPill(term);
    });

    // Forward terminal input to PTY
    runnerTerminal.onData((data) => {
      if (term.runnerPtyId) {
        window.api.pty.write(term.runnerPtyId, data);
      }
    });

    // Update pill to show running state
    updateRunnerPill(term);

  } catch (error) {
    runnerTerminal.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    term.runnerStatus = 'error';
    updateRunnerPill(term);
  }
}

/**
 * Update card stack visual positions
 */
export function updateCardStack(): void {
  const stack = document.querySelector('.theatre-stack') as HTMLElement;
  if (!stack) return;

  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  // Calculate number of back cards and adjust stack position
  // Each back card needs 24px of space for its visible tab
  const backCardCount = Math.min(currentTerminals.length - 1, 4);
  const tabSpace = backCardCount * 24;
  stack.style.top = `${82 + tabSpace}px`;

  // First pass: calculate back positions for all cards
  const backPositions: { index: number; diff: number }[] = [];
  currentTerminals.forEach((term, index) => {
    // Remove all position classes
    term.container.classList.remove('theatre-card--active', 'theatre-card--back-1', 'theatre-card--back-2', 'theatre-card--back-3', 'theatre-card--back-4');

    if (index === currentActiveIndex) {
      term.container.classList.add('theatre-card--active');
    } else {
      // Calculate back position relative to active
      const diff = index < currentActiveIndex ? currentActiveIndex - index : currentTerminals.length - index + currentActiveIndex;
      const backClass = `theatre-card--back-${Math.min(diff, 4)}`;
      term.container.classList.add(backClass);
      backPositions.push({ index, diff });
    }
  });

  // Sort by diff descending (highest diff = bottom of stack = ⌘1)
  backPositions.sort((a, b) => b.diff - a.diff);

  // Second pass: assign shortcuts and toggle runner pill visibility
  currentTerminals.forEach((term, index) => {
    const shortcutEl = term.container.querySelector('.theatre-card-shortcut') as HTMLElement;
    const runnerPill = term.container.querySelector('.runner-pill') as HTMLElement;

    if (index === currentActiveIndex) {
      // Active card: hide shortcut, show runner pill
      if (shortcutEl) shortcutEl.style.display = 'none';
      if (runnerPill) runnerPill.style.display = 'flex';
    } else {
      // Back card: show shortcut, hide runner pill
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
      if (runnerPill) runnerPill.style.display = 'none';
    }
  });
}

/**
 * Get the terminal index for a given stack position (1 = bottom, 2 = second from bottom, etc.)
 * Returns -1 if no terminal at that position
 */
export function getTerminalIndexByStackPosition(stackPosition: number): number {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length === 0) return -1;

  // Build back positions array (same logic as updateCardStack)
  const backPositions: { index: number; diff: number }[] = [];
  currentTerminals.forEach((_, index) => {
    if (index !== currentActiveIndex) {
      const diff = index < currentActiveIndex ? currentActiveIndex - index : currentTerminals.length - index + currentActiveIndex;
      backPositions.push({ index, diff });
    }
  });

  // Sort by diff descending (highest diff = bottom of stack = position 1)
  backPositions.sort((a, b) => b.diff - a.diff);

  // stackPosition is 1-indexed (⌘1 = position 1 = bottom)
  const arrayIndex = stackPosition - 1;
  if (arrayIndex >= 0 && arrayIndex < backPositions.length) {
    return backPositions[arrayIndex].index;
  }

  return -1;
}

/**
 * Switch to a specific theatre terminal
 */
export function switchToTheatreTerminal(index: number): void {
  const currentTerminals = terminals.value;
  if (index < 0 || index >= currentTerminals.length || index === activeIndex.value) return;

  // Set the new active index - effects will handle updateCardStack, focus, and resize
  activeIndex.value = index;
}

/**
 * Select item at stack position (1-indexed)
 * Handles both terminal switching and opening tasks from empty state
 */
export async function selectByStackPosition(position: number): Promise<void> {
  const currentTerminals = terminals.value;

  // If there are terminals, try to switch to the one at this stack position
  if (currentTerminals.length > 0) {
    const targetIndex = getTerminalIndexByStackPosition(position);
    if (targetIndex !== -1) {
      switchToTheatreTerminal(targetIndex);
    }
    // If position doesn't exist in stack, just ignore
    return;
  }

  // No terminals - open the task at this position from the empty state list
  const path = projectPath.value;
  if (!path) return;

  const tasks = await window.api.worktree.getTasks(path);
  const openTasks = tasks.filter(t => t.status === 'open');
  const taskIndex = position - 1;

  if (taskIndex >= 0 && taskIndex < openTasks.length) {
    const task = openTasks[taskIndex];
    await addTheatreTerminal(undefined, {
      existingWorktree: {
        path: task.path,
        branch: task.branch,
        taskName: task.name,
        createdAt: task.createdAt,
        readyToShip: task.readyToShip,
        prompt: task.prompt,
        sandboxed: task.sandboxed,
      },
      sandboxed: false,
    });
  }
}

/**
 * Options for adding a theatre terminal
 */
export interface AddTheatreTerminalOptions {
  useWorktree?: boolean;
  existingWorktree?: WorktreeInfo & { readyToShip?: boolean; prompt?: string; sandboxed?: boolean };
  worktreeName?: string;
  worktreePrompt?: string;
  sandboxed?: boolean;
}

/**
 * Add a new theatre terminal
 */
export async function addTheatreTerminal(runConfig?: RunConfig, options?: AddTheatreTerminalOptions): Promise<boolean> {
  const currentProjectPath = projectPath.value;
  const currentTerminals = terminals.value;

  if (!currentProjectPath || currentTerminals.length >= MAX_THEATRE_TERMINALS) {
    if (currentTerminals.length >= MAX_THEATRE_TERMINALS) {
      showToast(`Maximum ${MAX_THEATRE_TERMINALS} terminals`, 'info');
    }
    return false;
  }

  const stack = document.querySelector('.theatre-stack');
  if (!stack) return false;

  let terminalCwd = currentProjectPath;
  let worktreeInfo: (WorktreeInfo & { readyToShip?: boolean; prompt?: string }) | undefined = options?.existingWorktree;
  let loadingCard: HTMLElement | null = null;
  let taskPrompt: string | undefined = options?.existingWorktree?.prompt;

  // Show loading card immediately if creating a new worktree
  if (options?.useWorktree && !worktreeInfo) {
    const loadingLabel = options.worktreeName || 'New task';

    // Hide empty state if visible
    const emptyState = stack.querySelector('.theatre-stack-empty') as HTMLElement;
    if (emptyState) {
      emptyState.classList.remove('theatre-stack-empty--visible');
    }

    // Show loading card in the stack (pushes existing cards back)
    loadingCard = showLoadingCardInStack(loadingLabel);

    // Create worktree
    const result = await window.api.worktree.create(currentProjectPath, options.worktreeName, options.worktreePrompt);
    if (!result.success || !result.task || !result.worktreePath) {
      removeLoadingCard(loadingCard);
      // Restore stack positions
      updateCardStack();
      // Re-show empty state if no terminals
      if (terminals.value.length === 0 && emptyState) {
        emptyState.classList.add('theatre-stack-empty--visible');
      }
      showToast(result.error || 'Failed to create worktree', 'error');
      return false;
    }
    worktreeInfo = {
      path: result.worktreePath,
      branch: result.task.branch,
      taskName: result.task.name,
      createdAt: result.task.createdAt,
    };
    taskPrompt = options.worktreePrompt;
    // Persist sandbox preference for new task
    if (options?.sandboxed !== undefined) {
      await window.api.worktree.setSandboxed(currentProjectPath, worktreeInfo.branch, options.sandboxed);
    }
    invalidateTaskList();
  }

  // Use worktree path if we have one
  if (worktreeInfo) {
    terminalCwd = worktreeInfo.path;
  }

  const label = worktreeInfo
    ? (worktreeInfo.taskName || formatBranchNameForDisplay(worktreeInfo.branch))
    : (runConfig?.name || 'Shell');
  const command = runConfig?.command;
  const index = currentTerminals.length;

  // Remove loading card if present, then create real card
  if (loadingCard) {
    removeLoadingCard(loadingCard);
  }

  // Create card element
  const card = createTheatreCard(label, index);
  stack.appendChild(card);

  const xtermContainer = card.querySelector('.terminal-xterm-container') as HTMLElement;
  const closeBtn = card.querySelector('.theatre-card-close') as HTMLButtonElement;

  // Initialize xterm
  const terminal = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowTransparency: false,
    scrollback: 10000,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(xtermContainer);

  // Let app hotkeys pass through xterm
  setupTerminalAppHotkeys(terminal);

  // Enable native drag/drop on the terminal
  // xterm.js creates a .xterm-screen element that captures all mouse events,
  // so we need to attach handlers there after the terminal opens
  const setupDragDrop = (container: HTMLElement, term: Terminal) => {
    const screen = container.querySelector('.xterm-screen');
    const target = screen || container;

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
          .map(f => window.api.getPathForFile(f))
          .filter((p): p is string => !!p)
          .map(p => p.includes(' ') ? `"${p}"` : p)
          .join(' ');
        if (paths) {
          term.paste(paths);
        }
      }
    });
  };
  setupDragDrop(xtermContainer, terminal);

  await new Promise(resolve => requestAnimationFrame(resolve));
  fitAddon.fit();

  // Determine command to run - use start/continue hooks for worktree terminals if configured
  // - start hook: runs on new task creation (options.useWorktree)
  // - continue hook: runs when reopening existing task (options.existingWorktree)
  let startCommand = runConfig?.command;
  let startEnv: Record<string, string> | undefined;

  if (worktreeInfo && !runConfig) {
    const hooks = await window.api.hooks.get(currentProjectPath);
    // Use 'start' for new tasks, 'continue' for reopening existing tasks
    const isNewTask = options?.useWorktree && !options?.existingWorktree;
    const hookType = isNewTask ? 'start' : 'continue';
    const hook = isNewTask ? hooks.start : hooks.continue;

    if (hook) {
      startCommand = hook.command;
      // Build environment variables for the hook
      // All values must be defined strings for proper env var passing
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
    }
  }

  // Check if sandbox should be used (purely per-task)
  const limaStatus = await window.api.lima.status(currentProjectPath);
  const taskSandboxed = options?.sandboxed ?? options?.existingWorktree?.sandboxed;
  const useSandbox = limaStatus.available && taskSandboxed === true;

  // Spawn PTY
  const spawnOptions: PtySpawnOptions = {
    cwd: terminalCwd,
    projectPath: currentProjectPath,
    command: startCommand,
    cols: terminal.cols,
    rows: terminal.rows,
    label,
    isWorktree: !!worktreeInfo,
    worktreePath: worktreeInfo?.path,
    worktreeBranch: worktreeInfo?.branch,
    env: startEnv,
    sandboxed: useSandbox,
  };

  try {
    // Show progress for sandbox VM startup
    let cleanupProgress: (() => void) | null = null;
    if (useSandbox) {
      terminal.writeln(`\x1b[90m● Connecting to sandbox…\x1b[0m`);
      cleanupProgress = window.api.lima.onSpawnProgress((msg) => {
        terminal.writeln(`\x1b[90m● ${msg}\x1b[0m`);
      });
    }

    const result = await window.api.pty.spawn(spawnOptions);
    cleanupProgress?.();

    if (!result.success || !result.ptyId) {
      terminal.writeln(`\x1b[31mFailed to start terminal: ${result.error || 'Unknown error'}\x1b[0m`);
      terminal.writeln(`\x1b[90mThis card will close in 10 seconds.\x1b[0m`);
      setTimeout(() => {
        card.remove();
        terminal.dispose();
      }, 10_000);
      return false;
    }

    const theatreTerminal: TheatreTerminal = {
      ptyId: result.ptyId,
      projectPath: currentProjectPath,
      command: startCommand,
      label,
      terminal,
      fitAddon,
      container: card,
      cleanupData: null,
      cleanupExit: null,
      resizeObserver: null,
      summary: '',
      summaryType: 'idle',
      outputBuffer: '',
      lastOscTitle: '',
      isWorktree: !!worktreeInfo,
      worktreePath: worktreeInfo?.path,
      worktreeBranch: worktreeInfo?.branch,
      readyToShip: worktreeInfo?.readyToShip,
      // Per-terminal git status and diff panel state
      gitStatus: null,
      diffPanelOpen: false,
      diffPanelFiles: [],
      diffPanelSelectedFile: null,
      diffPanelMode: 'uncommitted',
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

    // Set up resize observer with debouncing to prevent zsh artifacts during animations
    theatreTerminal.resizeObserver = new ResizeObserver(() => {
      debouncedResize(result.ptyId!, terminal, fitAddon);
    });
    theatreTerminal.resizeObserver.observe(xtermContainer);

    // Set up data listener
    theatreTerminal.cleanupData = window.api.pty.onData(result.ptyId, (data) => {
      terminal.write(data);

      // Track output for summary analysis (rolling buffer of last 2000 chars)
      theatreTerminal.outputBuffer = (theatreTerminal.outputBuffer + data).slice(-2000);

      // Extract OSC title sequences (e.g., \x1b]0;Title Here\x07)
      const oscMatches = data.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
      for (const match of oscMatches) {
        const newTitle = match[1];
        if (newTitle !== theatreTerminal.lastOscTitle) {
          theatreTerminal.lastOscTitle = newTitle;
          updateTerminalCardLabel(theatreTerminal);
        }
      }

      scheduleTerminalSummaryUpdate(theatreTerminal);

      if (projectPath.value) {
        // Only schedule a refresh of this terminal's git status (not all terminals)
        scheduleTerminalGitStatusRefresh(theatreTerminal, updateTerminalCardLabel);
      }
    });

    // Set up exit listener
    theatreTerminal.cleanupExit = window.api.pty.onExit(result.ptyId, (exitCode) => {
      terminal.writeln('');
      const exitColor = exitCode === 0 ? '32' : '31';
      terminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);

      // Update summary to show exit status
      theatreTerminal.summary = exitCode === 0 ? 'Exited' : `Exit ${exitCode}`;
      theatreTerminal.summaryType = exitCode === 0 ? 'idle' : 'error';
      updateTerminalCardLabel(theatreTerminal);
    });

    // Forward terminal input
    terminal.onData((data) => {
      window.api.pty.write(result.ptyId!, data);
    });

    // Close button handler
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = terminals.value.indexOf(theatreTerminal);
      if (idx !== -1) {
        closeTheatreTerminal(idx);
      }
    });

    // Card click handler (to bring to front)
    card.addEventListener('click', () => {
      const idx = terminals.value.indexOf(theatreTerminal);
      if (idx !== -1 && idx !== activeIndex.value) {
        switchToTheatreTerminal(idx);
      }
    });

    // Set up card action buttons (runner pill, close-task for worktrees)
    setupCardActions(theatreTerminal);

    // Mark sandboxed terminals with a ring on the status dot
    if (useSandbox) {
      const dot = card.querySelector('.theatre-card-status-dot');
      if (dot) {
        dot.classList.add('theatre-card-status-dot--sandboxed');
      }
    }

    // Fetch initial git status for this terminal
    refreshTerminalGitStatus(theatreTerminal).then(() => {
      updateTerminalCardLabel(theatreTerminal);
    });

    // Add terminal to list and set as active - effects will handle updateCardStack
    terminals.value = [...terminals.value, theatreTerminal];
    activeIndex.value = terminals.value.length - 1;

    terminal.focus();
    return true;
  } catch (error) {
    terminal.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    card.remove();
    terminal.dispose();
    return false;
  }
}

/**
 * Close a theatre terminal
 */
export function closeTheatreTerminal(index: number): void {
  const currentTerminals = terminals.value;
  if (index < 0 || index >= currentTerminals.length) return;

  const term = currentTerminals[index];

  // Kill main PTY
  window.api.pty.kill(term.ptyId);

  // Clean up main terminal
  if (term.cleanupData) term.cleanupData();
  if (term.cleanupExit) term.cleanupExit();
  if (term.resizeObserver) term.resizeObserver.disconnect();
  term.terminal.dispose();

  // Clean up runner if active
  if (term.runnerPtyId) {
    window.api.pty.kill(term.runnerPtyId);
    if (term.runnerCleanupData) term.runnerCleanupData();
    if (term.runnerCleanupExit) term.runnerCleanupExit();
    if (term.runnerTerminal) term.runnerTerminal.dispose();
  }

  term.container.remove();

  // Remove terminal from list (immutable update)
  const newTerminals = currentTerminals.filter((_, i) => i !== index);
  terminals.value = newTerminals;

  // If no terminals left, nothing to adjust
  if (newTerminals.length === 0) {
    return;
  }

  // Adjust active index
  const currentActiveIndex = activeIndex.value;
  if (currentActiveIndex >= newTerminals.length) {
    activeIndex.value = newTerminals.length - 1;
  } else if (index < currentActiveIndex) {
    activeIndex.value = currentActiveIndex - 1;
  }

  // Effects will handle updateCardStack and focus
}

/**
 * Build HTML for the empty state shown when no terminals are open
 */
export function buildEmptyStateHtml(limaAvailable: boolean): string {
  return `
    <div class="theatre-stack-empty">
      <div class="theatre-stack-empty-open" style="display: none;">
        <div class="theatre-stack-empty-section-label">Continue</div>
        <div class="theatre-stack-empty-open-list"></div>
      </div>
      <div class="theatre-stack-empty-new">
        <div class="theatre-stack-empty-section-label"><span class="theatre-stack-empty-section-shortcut">${isMac ? '⌘' : 'Ctrl+'}<span class="shortcut-number">N</span></span>New Task</div>
        <form class="theatre-stack-empty-form">
          <div class="theatre-stack-empty-composer">
            <input
              type="text"
              class="theatre-stack-empty-name"
              placeholder="Task name"
              autocomplete="off"
              spellcheck="false"
            />
            <textarea
              class="theatre-stack-empty-prompt"
              placeholder="Describe what needs to be done..."
              rows="2"
              spellcheck="false"
            ></textarea>
            ${limaAvailable ? `
            <div class="new-task-composer-footer">
              <div class="new-task-sandbox-toggle">
                <div class="sandbox-toggle">
                  <div class="sandbox-toggle-knob"></div>
                </div>
                <span class="new-task-sandbox-label">Sandbox</span>
              </div>
            </div>
            ` : ''}
            <button type="submit" class="theatre-stack-empty-btn" aria-label="Start task">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </form>
      </div>
      <div class="theatre-stack-empty-hints">
        <span class="theatre-stack-empty-hint"><span class="theatre-stack-empty-hint-shortcut">${isMac ? '⌘' : 'Ctrl+'}<span class="shortcut-number">T</span></span>All Tasks</span>
      </div>
    </div>
  `;
}

/**
 * Populate the tasks lists in the empty state (only open tasks)
 */
async function populatePreviousTasks(emptyState: HTMLElement): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  const openSection = emptyState.querySelector('.theatre-stack-empty-open') as HTMLElement;
  const openList = emptyState.querySelector('.theatre-stack-empty-open-list') as HTMLElement;

  if (!openSection || !openList) return;

  // Fetch tasks with metadata
  const tasks = await window.api.worktree.getTasks(path);
  const openTasks = tasks.filter(t => t.status === 'open');

  // Check lima availability for context menu
  let limaAvailable = false;
  try {
    const limaStatus = await window.api.lima.status(path);
    limaAvailable = limaStatus.available;
  } catch { /* Lima not available */ }

  // Populate open tasks
  if (openTasks.length > 0) {
    openSection.style.display = 'block';
    openList.innerHTML = '';

    openTasks.forEach((task, index) => {
      const taskBtn = document.createElement('button');
      taskBtn.className = 'theatre-stack-empty-task';
      taskBtn.dataset.taskIndex = String(index);

      // Add shortcut indicator for first 9 tasks
      if (index < 9) {
        const shortcut = document.createElement('kbd');
        shortcut.className = 'theatre-stack-empty-task-shortcut';
        shortcut.innerHTML = isMac
          ? `⌘<span class="shortcut-number">${index + 1}</span>`
          : `Ctrl+<span class="shortcut-number">${index + 1}</span>`;
        taskBtn.appendChild(shortcut);
      }

      const nameSpan = document.createElement('span');
      nameSpan.textContent = task.name;
      taskBtn.appendChild(nameSpan);

      const worktreeOpts = {
        path: task.path,
        branch: task.branch,
        taskName: task.name,
        createdAt: task.createdAt,
        readyToShip: task.readyToShip,
        prompt: task.prompt,
        sandboxed: task.sandboxed,
      };

      // Normal click: open without sandbox
      taskBtn.addEventListener('click', async () => {
        await addTheatreTerminal(undefined, {
          existingWorktree: worktreeOpts,
          sandboxed: false,
        });
      });

      // Right-click: offer "Open in Sandbox" (only if lima available)
      if (limaAvailable) {
        taskBtn.addEventListener('contextmenu', (e) => {
          showTaskContextMenu(e, async () => {
            await addTheatreTerminal(undefined, {
              existingWorktree: worktreeOpts,
              sandboxed: true,
            });
          });
        });
      }

      openList.appendChild(taskBtn);
    });
  } else {
    openSection.style.display = 'none';
  }
}

/**
 * Show the empty state in the theatre stack
 */
export async function showStackEmptyState(): Promise<void> {
  const stack = document.querySelector('.theatre-stack');
  if (!stack) return;

  // Check if empty state already exists
  let emptyState = stack.querySelector('.theatre-stack-empty') as HTMLElement;
  if (emptyState) {
    // Already exists, refresh previous tasks and make visible
    await populatePreviousTasks(emptyState);
    requestAnimationFrame(() => {
      emptyState.classList.add('theatre-stack-empty--visible');
      const input = emptyState.querySelector('.theatre-stack-empty-name') as HTMLInputElement;
      if (input) input.focus();
    });
    return;
  }

  // Check lima availability for sandbox toggle
  const currentProjectPath = projectPath.value;
  let limaAvailable = false;
  if (currentProjectPath) {
    try {
      const limaStatus = await window.api.lima.status(currentProjectPath);
      limaAvailable = limaStatus.available;
    } catch {
      // Lima not available
    }
  }

  let sandboxState = false;

  // Create and insert empty state
  stack.insertAdjacentHTML('beforeend', buildEmptyStateHtml(limaAvailable));
  emptyState = stack.querySelector('.theatre-stack-empty') as HTMLElement;

  // Wire up form submission
  const form = emptyState.querySelector('.theatre-stack-empty-form') as HTMLFormElement;
  const nameInput = emptyState.querySelector('.theatre-stack-empty-name') as HTMLInputElement;
  const promptInput = emptyState.querySelector('.theatre-stack-empty-prompt') as HTMLTextAreaElement;
  const submitBtn = emptyState.querySelector('.theatre-stack-empty-btn') as HTMLButtonElement;

  // Wire up sandbox toggle if present
  const sandboxToggleRow = emptyState.querySelector('.new-task-sandbox-toggle');
  if (sandboxToggleRow) {
    sandboxToggleRow.addEventListener('click', () => {
      sandboxState = !sandboxState;
      const toggle = sandboxToggleRow.querySelector('.sandbox-toggle');
      if (toggle) {
        toggle.classList.toggle('sandbox-toggle--active', sandboxState);
      }
    });
  }

  // Note: ⌘1-9 hotkeys are already registered in enterTheatreMode for terminal switching.
  // We don't register them again here to avoid duplicate handlers that cause double-firing
  // when the task index scope is popped. Users can use Command+T to open the task index
  // for keyboard-based task selection.

  if (form && nameInput && promptInput && submitBtn) {
    // Enter in name field focuses description instead of submitting
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        promptInput.focus();
      }
    });

    // Mod+Enter in prompt field submits the form
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Prevent double submission
      if (submitBtn.disabled) return;

      const name = nameInput.value.trim() || undefined;
      const prompt = promptInput.value.trim() || undefined;

      // Disable form while creating (loading card provides visual feedback)
      submitBtn.disabled = true;
      nameInput.disabled = true;
      promptInput.disabled = true;

      try {
        const success = await addTheatreTerminal(undefined, {
          useWorktree: true,
          worktreeName: name,
          worktreePrompt: prompt,
          sandboxed: limaAvailable ? sandboxState : undefined,
        });
        if (!success) {
          // Restore form state if terminal creation failed
          submitBtn.disabled = false;
          nameInput.disabled = false;
          promptInput.disabled = false;
          nameInput.focus();
        }
        // If successful, the form will be hidden by the effect system
      } catch (error) {
        console.error('[theatre] Failed to create task:', error);
        showToast('Failed to create task', 'error');
        submitBtn.disabled = false;
        nameInput.disabled = false;
        promptInput.disabled = false;
        nameInput.focus();
      }
    });
  }

  // Populate previous tasks
  await populatePreviousTasks(emptyState);

  // Animate in and focus input
  requestAnimationFrame(() => {
    emptyState.classList.add('theatre-stack-empty--visible');
    if (nameInput) nameInput.focus();
  });
}

/**
 * Hide the empty state from the theatre stack
 */
export function hideStackEmptyState(): void {
  const emptyState = document.querySelector('.theatre-stack-empty') as HTMLElement;
  if (!emptyState) return;

  emptyState.classList.remove('theatre-stack-empty--visible');

  // Remove after animation
  setTimeout(() => {
    emptyState.remove();
  }, 200);
}

/**
 * Play or toggle runner for the active terminal (hotkey handler)
 * If runner is active, toggles its panel visibility
 * Otherwise, starts the default command as a runner
 */
async function playOrToggleRunner(): Promise<void> {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length === 0 || currentActiveIndex >= currentTerminals.length) {
    return;
  }

  const activeTerm = currentTerminals[currentActiveIndex];
  if (activeTerm.runnerPtyId) {
    toggleRunnerPanel(activeTerm);
  } else {
    await runDefaultInCard(activeTerm);
  }
}

/**
 * Refresh the empty state task list if it's currently visible
 */
export function refreshEmptyStateTasks(): void {
  const emptyState = document.querySelector('.theatre-stack-empty') as HTMLElement;
  if (emptyState) {
    populatePreviousTasks(emptyState);
  }
}

// Register functions in the theatre registry for cross-module access
theatreRegistry.addTheatreTerminal = addTheatreTerminal;
theatreRegistry.closeTheatreTerminal = closeTheatreTerminal;
theatreRegistry.playOrToggleRunner = playOrToggleRunner;
