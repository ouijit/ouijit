/**
 * Theatre terminal card management - multi-terminal UI, output analysis, card stack
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { createIcons, Terminal as TerminalIcon, Play, GitCompare, GitMerge, GitBranch } from 'lucide';
import type { PtyId, PtySpawnOptions, RunConfig, WorktreeInfo } from '../../types';
import {
  TheatreTerminal,
  SummaryType,
  MAX_THEATRE_TERMINALS,
} from './state';
import {
  projectPath,
  projectData,
  terminals,
  activeIndex,
} from './signals';
import { showToast } from '../importDialog';
import { scheduleGitStatusRefresh, refreshGitStatus, refreshTerminalGitStatus, buildCardGitStatusHtml, getTerminalGitPath, scheduleTerminalGitStatusRefresh } from './gitStatus';
import { toggleTerminalDiffPanel, toggleTerminalWorktreeDiffPanel } from './diffPanel';
import { mergeRunConfigs, getConfigId } from '../../utils/runConfigs';

const cardIcons = { Play, GitCompare, GitMerge, GitBranch };

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
    return { summary: 'Thinking...', type: 'thinking' };
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
    const display = term.summary
      ? `${term.label} — ${term.summary}`
      : term.label;
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
      <span class="theatre-card-label-text">${label}</span>
    </div>
    <div class="theatre-card-label-right">
      <button class="theatre-card-action theatre-card-action--worktree" data-action="run" title="Run default command" style="display: none;"><i data-lucide="play"></i></button>
      <button class="theatre-card-action theatre-card-action--worktree" data-action="diff" title="View diff vs main" style="display: none;"><i data-lucide="git-compare"></i></button>
      <button class="theatre-card-action theatre-card-action--worktree" data-action="merge" title="Merge into main" style="display: none;"><i data-lucide="git-merge"></i></button>
      <div class="theatre-card-git-wrapper"></div>
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

  // Show and wire up the worktree action buttons
  const worktreeButtons = labelEl.querySelectorAll('.theatre-card-action--worktree') as NodeListOf<HTMLElement>;
  worktreeButtons.forEach(btn => {
    btn.style.display = 'flex';
  });

  // Initialize lucide icons
  createIcons({ icons: cardIcons, nodes: [labelEl as Element] });

  // Wire up action buttons
  const runBtn = labelEl.querySelector('[data-action="run"]');
  const diffBtn = labelEl.querySelector('[data-action="diff"]');
  const mergeBtn = labelEl.querySelector('[data-action="merge"]');

  if (runBtn) {
    runBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await runDefaultInWorktreeCard(term);
    });
  }

  if (diffBtn) {
    diffBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleTerminalWorktreeDiffPanel(term);
    });
  }

  if (mergeBtn) {
    mergeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await mergeWorktreeFromCard(term);
    });
  }
}

/**
 * Run the default command in the worktree from a card action
 */
async function runDefaultInWorktreeCard(term: TheatreTerminal): Promise<void> {
  const path = projectPath.value;
  const project = projectData.value;
  if (!path || !project || !term.worktreePath || !term.worktreeBranch) return;

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

  const worktreeInfo: WorktreeInfo = {
    path: term.worktreePath,
    branch: term.worktreeBranch,
    createdAt: '',
  };

  await addTheatreTerminal(defaultConfig, { existingWorktree: worktreeInfo });
}

/**
 * Merge worktree branch into main from a card action
 */
async function mergeWorktreeFromCard(term: TheatreTerminal): Promise<void> {
  const path = projectPath.value;
  if (!path || !term.worktreeBranch) return;

  const confirmed = confirm(`Merge "${term.worktreeBranch}" into main?`);
  if (!confirmed) return;

  const result = await window.api.worktree.merge(path, term.worktreeBranch);
  if (result.success) {
    showToast(`Merged ${term.worktreeBranch} into main`, 'success');
    await refreshGitStatus();
  } else {
    showToast(result.error || 'Merge failed', 'error');
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
    }
  });
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
    command,
    cols: terminal.cols,
    rows: terminal.rows,
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
      isWorktree: !!worktreeInfo,
      worktreePath: worktreeInfo?.path,
      worktreeBranch: worktreeInfo?.branch,
      // Per-terminal git status and diff panel state
      gitStatus: null,
      diffPanelOpen: false,
      diffPanelFiles: [],
      diffPanelSelectedFile: null,
      diffPanelMode: 'uncommitted',
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
        theatreTerminal.lastOscTitle = match[1];
      }

      scheduleTerminalSummaryUpdate(theatreTerminal);

      if (projectPath.value) {
        scheduleGitStatusRefresh();
        // Also schedule a refresh of this terminal's git status
        scheduleTerminalGitStatusRefresh(theatreTerminal);
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

  // Kill PTY
  window.api.pty.kill(term.ptyId);

  // Clean up
  if (term.cleanupData) term.cleanupData();
  if (term.cleanupExit) term.cleanupExit();
  if (term.resizeObserver) term.resizeObserver.disconnect();
  term.terminal.dispose();
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
      <i data-lucide="terminal" class="theatre-stack-empty-icon"></i>
      <h3 class="theatre-stack-empty-title">No terminals open</h3>
      <p class="theatre-stack-empty-description">
        Launch a command or open a shell to get started with your project.
      </p>
      <div class="theatre-stack-empty-actions">
        <button class="theatre-stack-empty-btn theatre-stack-empty-btn--primary" data-action="new-terminal">
          <i data-lucide="terminal"></i>
          New Terminal
        </button>
        <button class="theatre-stack-empty-btn theatre-stack-empty-btn--secondary" data-action="run-command">
          <i data-lucide="play"></i>
          Run Command
        </button>
      </div>
      <p class="theatre-stack-empty-hint">
        Press <kbd>Esc</kbd> to exit theatre mode
      </p>
    </div>
  `;
}

/**
 * Show the empty state in the theatre stack
 */
export function showStackEmptyState(): void {
  const stack = document.querySelector('.theatre-stack');
  if (!stack) return;

  // Check if empty state already exists
  let emptyState = stack.querySelector('.theatre-stack-empty') as HTMLElement;
  if (emptyState) {
    // Already exists, just make it visible
    requestAnimationFrame(() => {
      emptyState.classList.add('theatre-stack-empty--visible');
    });
    return;
  }

  // Create and insert empty state
  stack.insertAdjacentHTML('beforeend', buildEmptyStateHtml());
  emptyState = stack.querySelector('.theatre-stack-empty') as HTMLElement;

  // Initialize icons
  createIcons({ icons: { Terminal: TerminalIcon, Play }, nodes: [emptyState] });

  // Wire up button handlers
  const newTerminalBtn = emptyState.querySelector('[data-action="new-terminal"]');
  if (newTerminalBtn) {
    newTerminalBtn.addEventListener('click', async () => {
      await addTheatreTerminal();
    });
  }

  const runCommandBtn = emptyState.querySelector('[data-action="run-command"]');
  if (runCommandBtn) {
    runCommandBtn.addEventListener('click', async () => {
      // Import dynamically to avoid circular dependencies
      const { toggleLaunchDropdown } = await import('./launchDropdown');
      toggleLaunchDropdown();
    });
  }

  // Animate in
  requestAnimationFrame(() => {
    emptyState.classList.add('theatre-stack-empty--visible');
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
