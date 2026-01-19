/**
 * Theatre terminal card management - multi-terminal UI, output analysis, card stack
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { createIcons, Terminal as TerminalIcon, Play, GitCompare, GitMerge, GitBranch, Check } from 'lucide';
import type { PtyId, PtySpawnOptions, RunConfig, WorktreeInfo } from '../../types';
import {
  TheatreTerminal,
  SummaryType,
  MAX_THEATRE_TERMINALS,
  theatreState,
} from './state';
import { getTerminalGitPath, hideRunnerPanel, theatreRegistry } from './helpers';
import {
  projectPath,
  projectData,
  terminals,
  activeIndex,
} from './signals';
import { showToast } from '../importDialog';
import { scheduleGitStatusRefresh, refreshTerminalGitStatus, buildCardGitStatusHtml, scheduleTerminalGitStatusRefresh } from './gitStatus';
import { toggleTerminalDiffPanel, toggleTerminalWorktreeDiffPanel, hideTerminalDiffPanel } from './diffPanel';
import { mergeRunConfigs, getConfigId } from '../../utils/runConfigs';

const cardIcons = { Play, GitCompare, GitMerge, GitBranch, Check };

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
 * Debug: Maximum number of OSC titles to keep in history
 */
const OSC_HISTORY_MAX = 50;

/**
 * Debug: Create or get the OSC debug overlay for a terminal card
 */
function getOrCreateOscDebugOverlay(container: HTMLElement): HTMLElement {
  let overlay = container.querySelector('.osc-debug-overlay') as HTMLElement;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'osc-debug-overlay';
    overlay.innerHTML = `
      <div class="osc-debug-header">
        <span class="osc-debug-title">OSC Title Debug</span>
        <button class="osc-debug-close">&times;</button>
      </div>
      <div class="osc-debug-current">
        <span class="osc-debug-label">Current:</span>
        <code class="osc-debug-value">—</code>
      </div>
      <div class="osc-debug-history">
        <span class="osc-debug-label">History:</span>
        <div class="osc-debug-history-list"></div>
      </div>
    `;

    const cardBody = container.querySelector('.theatre-card-body');
    if (cardBody) {
      cardBody.appendChild(overlay);
    }

    // Wire up close button
    const closeBtn = overlay.querySelector('.osc-debug-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOscDebug();
      });
    }
  }
  return overlay;
}

/**
 * Debug: Update the OSC debug overlay for a terminal
 */
function updateOscDebugOverlay(term: TheatreTerminal): void {
  if (!theatreState.oscDebugEnabled) return;

  const overlay = getOrCreateOscDebugOverlay(term.container);
  overlay.style.display = 'flex';

  // Update current value
  const currentValue = overlay.querySelector('.osc-debug-value') as HTMLElement;
  if (currentValue) {
    currentValue.textContent = term.lastOscTitle || '(empty)';
  }

  // Update history list
  const historyList = overlay.querySelector('.osc-debug-history-list') as HTMLElement;
  if (historyList && term.oscTitleHistory) {
    const items = term.oscTitleHistory.slice().reverse().slice(0, 20).map(entry => {
      const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      });
      // Escape HTML and show special chars
      const displayTitle = entry.title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<div class="osc-debug-history-item"><span class="osc-debug-time">${time}</span><code>${displayTitle || '(empty)'}</code></div>`;
    }).join('');
    historyList.innerHTML = items || '<div class="osc-debug-history-empty">No history yet</div>';
  }
}

/**
 * Debug: Toggle OSC debug overlay visibility for all terminals
 */
export function toggleOscDebug(): void {
  theatreState.oscDebugEnabled = !theatreState.oscDebugEnabled;

  const currentTerminals = terminals.value;
  for (const term of currentTerminals) {
    const overlay = term.container.querySelector('.osc-debug-overlay') as HTMLElement;
    if (theatreState.oscDebugEnabled) {
      updateOscDebugOverlay(term);
    } else if (overlay) {
      overlay.style.display = 'none';
    }
  }

  console.log(`[Debug] OSC title debug ${theatreState.oscDebugEnabled ? 'enabled' : 'disabled'}`);
}

/**
 * Debug: Add an OSC title to a terminal's history
 */
function addOscTitleToHistory(term: TheatreTerminal, title: string): void {
  if (!term.oscTitleHistory) {
    term.oscTitleHistory = [];
  }

  term.oscTitleHistory.push({ title, timestamp: Date.now() });

  // Keep history bounded
  if (term.oscTitleHistory.length > OSC_HISTORY_MAX) {
    term.oscTitleHistory = term.oscTitleHistory.slice(-OSC_HISTORY_MAX);
  }

  // Update overlay if debug is enabled
  if (theatreState.oscDebugEnabled) {
    updateOscDebugOverlay(term);
  }
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

  // Update git status display
  const gitWrapper = labelEl.querySelector('.theatre-card-git-wrapper') as HTMLElement;
  if (gitWrapper) {
    const gitHtml = buildCardGitStatusHtml(term.gitStatus);
    gitWrapper.innerHTML = gitHtml;

    // Initialize icons
    if (gitHtml) {
      createIcons({ icons: cardIcons, nodes: [gitWrapper] });

      // Wire up click handler for stats (only if clickable)
      const statsEl = gitWrapper.querySelector('.theatre-card-git-stats--clickable') as HTMLElement;
      if (statsEl) {
        statsEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const diffType = statsEl.dataset.diffType;
          // For worktree terminals with branch diff, show worktree vs main
          // Otherwise show uncommitted changes
          if (term.isWorktree && diffType === 'branch') {
            toggleTerminalWorktreeDiffPanel(term);
          } else {
            toggleTerminalDiffPanel(term);
          }
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
      <span class="theatre-card-status-dot" data-status="idle"></span>
      <kbd class="theatre-card-shortcut" style="display: none;"></kbd>
      <span class="theatre-card-label-text">${label}</span>
    </div>
    <div class="theatre-card-label-right">
      <div class="theatre-card-git-wrapper"></div>
      <div class="runner-pill theatre-card-action--worktree" style="display: none;">
        <button class="runner-pill-play" data-action="run" title="Run default command"><i data-lucide="play"></i></button>
        <div class="runner-pill-status">
          <span class="runner-pill-light"></span>
          <span class="runner-pill-label"></span>
        </div>
      </div>
      <button class="theatre-card-close-task theatre-card-action--worktree" style="display: none;" title="Close task"><i data-lucide="check"></i></button>
      <button class="theatre-card-close" title="Close terminal">&times;</button>
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
 * Set up worktree action buttons on a card
 */
export function setupWorktreeCardActions(term: TheatreTerminal): void {
  if (!term.isWorktree || !term.worktreeBranch) return;

  const labelEl = term.container.querySelector('.theatre-card-label');
  if (!labelEl) return;

  // Show runner pill for worktree terminals
  const runnerPill = labelEl.querySelector('.runner-pill') as HTMLElement;
  if (runnerPill) {
    runnerPill.style.display = 'flex';
  }

  // Show close button for worktree terminals
  const closeBtn = labelEl.querySelector('.theatre-card-close-task') as HTMLElement;
  if (closeBtn) {
    closeBtn.style.display = 'flex';

    // Wire up close button
    closeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await closeTaskFromTerminal(term);
    });
  }

  // Initialize lucide icons
  createIcons({ icons: cardIcons, nodes: [labelEl as Element] });

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
        await runDefaultInWorktreeCard(term);
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
    showToast('Task closed', 'success');
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
        <div class="runner-panel-actions">
          <button class="runner-panel-collapse" title="Collapse panel">−</button>
          <button class="runner-panel-kill" title="Stop runner">&times;</button>
        </div>
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
    cardBody.insertAdjacentHTML('beforeend', buildRunnerPanelHtml(term.runnerLabel || 'Runner'));
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

  // Refit terminals after animation
  setTimeout(() => {
    term.fitAddon.fit();
    window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
    if (term.runnerFitAddon && term.runnerPtyId) {
      term.runnerFitAddon.fit();
      window.api.pty.resize(term.runnerPtyId, term.runnerTerminal!.cols, term.runnerTerminal!.rows);
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
  term.runnerStatus = 'idle';
  term.runnerCleanupData = null;
  term.runnerCleanupExit = null;

  // Collapse the pill
  updateRunnerPill(term);
}


/**
 * Run the default command in the worktree as a hidden runner
 */
async function runDefaultInWorktreeCard(term: TheatreTerminal): Promise<void> {
  const path = projectPath.value;
  const project = projectData.value;
  if (!path || !project || !term.worktreePath || !term.worktreeBranch) return;

  // If runner already active, kill it first
  if (term.runnerPtyId) {
    killRunner(term);
  }

  // Fetch settings to get default command
  const settings = await window.api.getProjectSettings(path);
  const allConfigs = mergeRunConfigs(project.runConfigs, settings.customCommands);

  if (allConfigs.length === 0) {
    showToast('No commands configured', 'info');
    return;
  }

  // Find default command or use first available
  let defaultConfig: RunConfig = allConfigs[0];
  if (settings.defaultCommandId) {
    const found = allConfigs.find(c => getConfigId(c) === settings.defaultCommandId);
    if (found) {
      defaultConfig = found;
    }
  }

  // Set initial runner state
  term.runnerLabel = defaultConfig.name;
  term.runnerStatus = 'running';

  // Create hidden terminal for runner output
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


  term.runnerTerminal = runnerTerminal;
  term.runnerFitAddon = runnerFitAddon;

  // Spawn PTY for the runner
  const spawnOptions: PtySpawnOptions = {
    cwd: term.worktreePath,
    projectPath: path,  // Use main project path for session grouping during restore
    command: defaultConfig.command,
    cols: 80,  // Default size, will be resized when panel opens
    rows: 24,
    label: defaultConfig.name,
    isWorktree: true,
    worktreePath: term.worktreePath,
    worktreeBranch: term.worktreeBranch,
    isRunner: true,
    parentPtyId: term.ptyId,
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

  // Second pass: assign shortcuts based on visual stack position (bottom to top)
  currentTerminals.forEach((term, index) => {
    const shortcutEl = term.container.querySelector('.theatre-card-shortcut') as HTMLElement;
    if (shortcutEl) {
      if (index === currentActiveIndex) {
        shortcutEl.style.display = 'none';
      } else {
        // Find this terminal's position in the sorted back cards
        const stackPosition = backPositions.findIndex(bp => bp.index === index);
        if (stackPosition !== -1 && stackPosition < 9) {
          shortcutEl.textContent = `⌘${stackPosition + 1}`;
          shortcutEl.style.display = '';
        } else {
          shortcutEl.style.display = 'none';
        }
      }
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

  // Set the new active index - effects will handle updateCardStack and focus
  activeIndex.value = index;

  // Resize PTY to match terminal dimensions
  const term = currentTerminals[index];
  requestAnimationFrame(() => {
    window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
  });
}

/**
 * Select item at stack position (1-indexed)
 * Handles both terminal switching and opening tasks from empty state
 */
export async function selectByStackPosition(position: number): Promise<void> {
  const targetIndex = getTerminalIndexByStackPosition(position);
  if (targetIndex !== -1) {
    switchToTheatreTerminal(targetIndex);
    return;
  }

  // No terminals - open the task at this position
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
        createdAt: task.createdAt,
      },
    });
  }
}

/**
 * Options for adding a theatre terminal
 */
export interface AddTheatreTerminalOptions {
  useWorktree?: boolean;
  existingWorktree?: WorktreeInfo;
  worktreeName?: string;
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
  let worktreeInfo: WorktreeInfo | undefined = options?.existingWorktree;

  // Create worktree if requested
  if (options?.useWorktree && !worktreeInfo) {
    const result = await window.api.worktree.create(currentProjectPath, options.worktreeName);
    if (!result.success || !result.worktree) {
      showToast(result.error || 'Failed to create worktree', 'error');
      return false;
    }
    worktreeInfo = result.worktree;
    // Refresh task index if visible
    theatreRegistry.refreshTaskIndex?.();
  }

  // Use worktree path if we have one
  if (worktreeInfo) {
    terminalCwd = worktreeInfo.path;
  }

  const label = worktreeInfo ? formatBranchNameForDisplay(worktreeInfo.branch) : (runConfig?.name || 'Shell');
  const command = runConfig?.command;
  const index = currentTerminals.length;

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
    allowTransparency: true,
    scrollback: 10000,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(xtermContainer);


  await new Promise(resolve => requestAnimationFrame(resolve));
  fitAddon.fit();

  // Spawn PTY
  const spawnOptions: PtySpawnOptions = {
    cwd: terminalCwd,
    projectPath: currentProjectPath,
    command,
    cols: terminal.cols,
    rows: terminal.rows,
    label,
    isWorktree: !!worktreeInfo,
    worktreePath: worktreeInfo?.path,
    worktreeBranch: worktreeInfo?.branch,
  };

  try {
    const result = await window.api.pty.spawn(spawnOptions);

    if (!result.success || !result.ptyId) {
      terminal.writeln(`\x1b[31mFailed to start terminal: ${result.error || 'Unknown error'}\x1b[0m`);
      card.remove();
      terminal.dispose();
      return false;
    }

    const theatreTerminal: TheatreTerminal = {
      ptyId: result.ptyId,
      projectPath: currentProjectPath,
      command,
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
      oscTitleHistory: [],
      isWorktree: !!worktreeInfo,
      worktreePath: worktreeInfo?.path,
      worktreeBranch: worktreeInfo?.branch,
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
      runnerStatus: 'idle',
      runnerCleanupData: null,
      runnerCleanupExit: null,
    };

    // Set up resize observer
    theatreTerminal.resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.api.pty.resize(result.ptyId!, terminal.cols, terminal.rows);
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
          addOscTitleToHistory(theatreTerminal, newTitle);
          updateTerminalCardLabel(theatreTerminal);
        }
      }

      scheduleTerminalSummaryUpdate(theatreTerminal);

      if (projectPath.value) {
        scheduleGitStatusRefresh();
        // Also schedule a refresh of this terminal's git status
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

    // Set up worktree action buttons if this is a worktree terminal
    setupWorktreeCardActions(theatreTerminal);

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
export function buildEmptyStateHtml(): string {
  return `
    <div class="theatre-stack-empty">
      <div class="theatre-stack-empty-open" style="display: none;">
        <div class="theatre-stack-empty-section-label">Continue</div>
        <div class="theatre-stack-empty-open-list"></div>
      </div>
      <div class="theatre-stack-empty-new">
        <div class="theatre-stack-empty-section-label"><span class="theatre-stack-empty-section-shortcut">⌘N</span>New Task</div>
        <form class="theatre-stack-empty-form">
          <input
            type="text"
            class="theatre-stack-empty-input"
            placeholder="fix login bug, add dark mode..."
            autocomplete="off"
            spellcheck="false"
          />
          <button type="submit" class="theatre-stack-empty-btn">Start</button>
        </form>
      </div>
      <div class="theatre-stack-empty-hints">
        <span class="theatre-stack-empty-hint"><span class="theatre-stack-empty-hint-shortcut">⌘T</span>All Tasks</span>
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
        shortcut.textContent = `⌘${index + 1}`;
        taskBtn.appendChild(shortcut);
      }

      const nameSpan = document.createElement('span');
      nameSpan.textContent = task.name;
      taskBtn.appendChild(nameSpan);

      taskBtn.addEventListener('click', async () => {
        await addTheatreTerminal(undefined, {
          existingWorktree: {
            path: task.path,
            branch: task.branch,
            createdAt: task.createdAt,
          },
        });
      });
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
      const input = emptyState.querySelector('.theatre-stack-empty-input') as HTMLInputElement;
      if (input) input.focus();
    });
    return;
  }

  // Create and insert empty state
  stack.insertAdjacentHTML('beforeend', buildEmptyStateHtml());
  emptyState = stack.querySelector('.theatre-stack-empty') as HTMLElement;

  // Wire up form submission
  const form = emptyState.querySelector('.theatre-stack-empty-form') as HTMLFormElement;
  const input = emptyState.querySelector('.theatre-stack-empty-input') as HTMLInputElement;
  const submitBtn = emptyState.querySelector('.theatre-stack-empty-btn') as HTMLButtonElement;

  // Note: ⌘1-9 hotkeys are already registered in enterTheatreMode for terminal switching.
  // We don't register them again here to avoid duplicate handlers that cause double-firing
  // when the task index scope is popped. Users can use Command+T to open the task index
  // for keyboard-based task selection.

  if (form && input && submitBtn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Prevent double submission
      if (submitBtn.disabled) return;

      const name = input.value.trim() || undefined;

      // Show loading state
      submitBtn.disabled = true;
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Creating...';
      input.disabled = true;

      try {
        const success = await addTheatreTerminal(undefined, { useWorktree: true, worktreeName: name });
        if (!success) {
          // Restore form state if terminal creation failed
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          input.disabled = false;
        }
        // If successful, the form will be hidden by the effect system
      } catch (error) {
        console.error('[theatre] Failed to create task:', error);
        showToast('Failed to create task', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        input.disabled = false;
      }
    });
  }

  // Populate previous tasks
  await populatePreviousTasks(emptyState);

  // Animate in and focus input
  requestAnimationFrame(() => {
    emptyState.classList.add('theatre-stack-empty--visible');
    if (input) input.focus();
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

// Register functions in the theatre registry for cross-module access
theatreRegistry.addTheatreTerminal = addTheatreTerminal;
theatreRegistry.closeTheatreTerminal = closeTheatreTerminal;
