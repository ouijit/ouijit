import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { createIcons, Maximize2, Minimize2, RefreshCw, GitBranch, ChevronDown } from 'lucide';
import type { PtyId, PtySpawnOptions, Project, GitStatus, GitDropdownInfo, ChangedFile, FileDiff } from '../types';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { showToast } from './importDialog';

const theatreIcons = { Maximize2, Minimize2, RefreshCw, GitBranch, ChevronDown };

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  ptyId: PtyId | null;
  container: HTMLElement;
  cleanupData: (() => void) | null;
  cleanupExit: (() => void) | null;
  resizeObserver: ResizeObserver | null;
}

const terminals = new Map<string, TerminalInstance>();

// Theatre mode state
let theatreModeProjectPath: string | null = null;
let originalHeaderContent: string | null = null;
let escapeKeyHandler: ((e: KeyboardEvent) => void) | null = null;

// Git status idle refresh state
let gitStatusIdleTimeout: ReturnType<typeof setTimeout> | null = null;
let lastTerminalOutputTime: number = 0;
const GIT_STATUS_IDLE_DELAY = 1000; // 1 second of idle before refreshing

// Git dropdown state
let gitDropdownVisible = false;
let gitDropdownCleanup: (() => void) | null = null;

// Diff panel state
let diffPanelVisible = false;
let diffPanelSelectedFile: string | null = null;
let diffPanelFiles: ChangedFile[] = [];
let diffFileDropdownVisible = false;
let diffFileDropdownCleanup: (() => void) | null = null;

function createTerminalContainer(projectPath: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'terminal-accordion';
  container.dataset.projectPath = projectPath;

  const header = document.createElement('div');
  header.className = 'terminal-header';

  const title = document.createElement('span');
  title.className = 'terminal-title';
  title.textContent = 'Terminal';

  const controls = document.createElement('div');
  controls.className = 'terminal-controls';

  const theatreBtn = document.createElement('button');
  theatreBtn.className = 'terminal-theatre-btn';
  theatreBtn.innerHTML = '<i data-lucide="maximize-2"></i>';
  theatreBtn.title = 'Theatre mode';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'terminal-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Close terminal';

  controls.appendChild(theatreBtn);
  controls.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(controls);

  const viewport = document.createElement('div');
  viewport.className = 'terminal-viewport';

  const xtermContainer = document.createElement('div');
  xtermContainer.className = 'terminal-xterm-container';
  viewport.appendChild(xtermContainer);

  container.appendChild(header);
  container.appendChild(viewport);

  return container;
}

function getTerminalTheme(): Record<string, string> {
  // Always use dark theme for terminal - matches the dark container
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

export async function createTerminal(
  projectPath: string,
  command: string | undefined,
  anchorElement: HTMLElement,
  projectData?: Project
): Promise<{ success: boolean; error?: string }> {
  // Check if terminal already exists for this project
  if (terminals.has(projectPath)) {
    const existing = terminals.get(projectPath)!;
    existing.container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    existing.terminal.focus();
    return { success: true };
  }

  // Create container and insert after anchor element
  const container = createTerminalContainer(projectPath);
  anchorElement.insertAdjacentElement('afterend', container);

  const viewport = container.querySelector('.terminal-viewport') as HTMLElement;
  const xtermContainer = container.querySelector('.terminal-xterm-container') as HTMLElement;
  const closeBtn = container.querySelector('.terminal-close-btn') as HTMLButtonElement;
  const theatreBtn = container.querySelector('.terminal-theatre-btn') as HTMLButtonElement;

  // Initialize lucide icons for the theatre button
  createIcons({ icons: theatreIcons, nodes: [container] });

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

  // Wait for next frame before fitting
  await new Promise(resolve => requestAnimationFrame(resolve));
  fitAddon.fit();

  // Store terminal instance
  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    ptyId: null,
    container,
    cleanupData: null,
    cleanupExit: null,
    resizeObserver: null,
  };
  terminals.set(projectPath, instance);

  // Set up resize observer on the xterm container (not viewport, which has padding)
  instance.resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (instance.ptyId) {
      window.api.pty.resize(instance.ptyId, terminal.cols, terminal.rows);
    }
  });
  instance.resizeObserver.observe(xtermContainer);

  // Set up close button
  closeBtn.addEventListener('click', () => {
    destroyTerminal(projectPath);
  });

  // Set up theatre mode button
  console.log('[Theatre] createTerminal called with projectData:', projectData);
  theatreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[Theatre] Button clicked, projectData:', projectData);
    const isInTheatre = container.classList.contains('terminal-accordion--theatre');
    if (isInTheatre) {
      exitTheatreMode();
    } else if (projectData) {
      enterTheatreMode(projectPath, projectData);
    } else {
      console.error('[Theatre] No projectData available!');
    }
  });

  // Spawn PTY
  const spawnOptions: PtySpawnOptions = {
    cwd: projectPath,
    command,
    cols: terminal.cols,
    rows: terminal.rows,
  };

  try {
    const result = await window.api.pty.spawn(spawnOptions);

    if (!result.success || !result.ptyId) {
      terminal.writeln(`\x1b[31mFailed to start terminal: ${result.error || 'Unknown error'}\x1b[0m`);
      return { success: false, error: result.error };
    }

    instance.ptyId = result.ptyId;

    // Set up data listener
    instance.cleanupData = window.api.pty.onData(result.ptyId, (data) => {
      terminal.write(data);
      // Schedule git status refresh if in theatre mode for this terminal
      if (theatreModeProjectPath === projectPath) {
        scheduleGitStatusRefresh();
      }
    });

    // Set up exit listener
    instance.cleanupExit = window.api.pty.onExit(result.ptyId, (exitCode) => {
      terminal.writeln('');
      const exitColor = exitCode === 0 ? '32' : '31'; // green for success, red for error
      terminal.writeln(`\x1b[${exitColor}m● Process exited with code ${exitCode}\x1b[0m`);
    });

    // Forward terminal input to PTY
    terminal.onData((data) => {
      if (instance.ptyId) {
        window.api.pty.write(instance.ptyId, data);
      }
    });

    // Animate accordion open
    requestAnimationFrame(() => {
      container.classList.add('terminal-accordion--open');
    });
    terminal.focus();

    return { success: true };
  } catch (error) {
    terminal.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function destroyTerminal(projectPath: string): void {
  const instance = terminals.get(projectPath);
  if (!instance) return;

  // Exit theatre mode if this terminal is in theatre mode
  if (theatreModeProjectPath === projectPath) {
    exitTheatreMode();
  }

  // Kill PTY if running
  if (instance.ptyId) {
    window.api.pty.kill(instance.ptyId);
  }

  // Clean up event listeners
  if (instance.cleanupData) instance.cleanupData();
  if (instance.cleanupExit) instance.cleanupExit();
  if (instance.resizeObserver) instance.resizeObserver.disconnect();

  // Animate close and remove
  instance.container.classList.remove('terminal-accordion--open');

  const handleTransitionEnd = () => {
    instance.terminal.dispose();
    instance.container.remove();
  };

  instance.container.addEventListener('transitionend', handleTransitionEnd, { once: true });

  // Fallback if no transition
  setTimeout(() => {
    if (instance.container.parentNode) {
      handleTransitionEnd();
    }
  }, 300);

  terminals.delete(projectPath);
}

export function hasTerminal(projectPath: string): boolean {
  return terminals.has(projectPath);
}

/**
 * Returns project paths that currently have open terminals
 */
export function getOpenTerminalPaths(): string[] {
  return Array.from(terminals.keys());
}

/**
 * Re-attaches an existing terminal to a new anchor element after DOM refresh.
 * Returns true if successful, false if terminal doesn't exist.
 */
export function reattachTerminal(projectPath: string, newAnchorElement: HTMLElement): boolean {
  const instance = terminals.get(projectPath);
  if (!instance) return false;

  // Insert existing container after the new anchor
  newAnchorElement.insertAdjacentElement('afterend', instance.container);
  newAnchorElement.classList.add('project-row--has-terminal');

  // Re-fit terminal after DOM insertion
  requestAnimationFrame(() => {
    instance.fitAddon.fit();
    if (instance.ptyId) {
      window.api.pty.resize(instance.ptyId, instance.terminal.cols, instance.terminal.rows);
    }
  });

  return true;
}

export function destroyAllTerminals(): void {
  for (const projectPath of terminals.keys()) {
    destroyTerminal(projectPath);
  }
}

/**
 * Build git status HTML (clickable pill)
 */
function buildGitStatusHtml(gitStatus: GitStatus | null): string {
  if (!gitStatus) return '';

  const indicatorClass = gitStatus.isDirty ? 'theatre-git-indicator--dirty' : 'theatre-git-indicator--clean';

  return `
    <div class="theatre-git-status theatre-git-status--clickable" role="button" tabindex="0">
      <i data-lucide="git-branch" class="theatre-git-icon"></i>
      <span class="theatre-git-branch">${gitStatus.branch}</span>
      <span class="theatre-git-indicator ${indicatorClass}"></span>
    </div>
  `;
}

/**
 * Build git dropdown HTML
 */
function buildGitDropdownHtml(info: GitDropdownInfo): string {
  const { current, recentBranches } = info;

  // Build ahead/behind indicators
  let aheadBehindHtml = '';
  if (current.ahead > 0 || current.behind > 0) {
    const aheadPart = current.ahead > 0 ? `<span class="ahead">\u2191${current.ahead}</span>` : '';
    const behindPart = current.behind > 0 ? `<span class="behind">\u2193${current.behind}</span>` : '';
    aheadBehindHtml = `<div class="git-dropdown-ahead-behind">${aheadPart}${behindPart}</div>`;
  }

  // Build uncommitted changes line or "up to date" status
  let uncommittedHtml = '';
  if (current.uncommitted) {
    const { filesChanged, insertions, deletions } = current.uncommitted;
    const parts: string[] = [];
    parts.push(`${filesChanged} file${filesChanged === 1 ? '' : 's'}`);
    if (insertions > 0) parts.push(`<span class="insertions">+${insertions}</span>`);
    if (deletions > 0) parts.push(`<span class="deletions">-${deletions}</span>`);
    uncommittedHtml = `<div class="git-dropdown-uncommitted git-dropdown-uncommitted--clickable" role="button" title="View changes">${parts.join(' \u00B7 ')}</div>`;
  } else if (current.ahead === 0 && current.behind === 0) {
    uncommittedHtml = `<div class="git-dropdown-uncommitted">Up to date</div>`;
  }

  // Build recent branches list
  let recentBranchesHtml = '';
  if (recentBranches.length > 0) {
    const branchItems = recentBranches.map(branch => {
      const statsHtml = branch.commitsAhead > 0
        ? `+${branch.commitsAhead} \u00B7 ${branch.lastCommitAge}`
        : branch.lastCommitAge;
      return `
        <div class="git-dropdown-branch" data-branch="${branch.name}">
          <span class="git-dropdown-branch-name">${branch.name}</span>
          <span class="git-dropdown-branch-stats">${statsHtml}</span>
        </div>
      `;
    }).join('');

    recentBranchesHtml = `
      <div class="git-dropdown-recent">
        <div class="git-dropdown-recent-header">Recent Branches</div>
        ${branchItems}
      </div>
    `;
  }

  return `
    <div class="theatre-git-dropdown">
      <div class="git-dropdown-current">
        <div class="git-dropdown-branch-row">
          <span class="git-dropdown-branch-name">${current.branch}</span>
          ${aheadBehindHtml}
        </div>
        ${uncommittedHtml}
      </div>
      ${recentBranchesHtml}
    </div>
  `;
}

/**
 * Switch to a branch using IPC git checkout
 */
async function switchToBranch(branchName: string): Promise<void> {
  if (!theatreModeProjectPath) return;

  // Close dropdown immediately for responsiveness
  hideGitDropdown();

  const result = await window.api.gitCheckout(theatreModeProjectPath, branchName);

  if (result.success) {
    showToast(`Switched to ${branchName}`, 'success');
    // Trigger git status refresh to update the UI
    await refreshGitStatus();
  } else {
    showToast(result.error || 'Checkout failed', 'error');
  }
}

/**
 * Show the git dropdown
 */
async function showGitDropdown(projectPath: string): Promise<void> {
  if (gitDropdownVisible) return;

  const gitStatusEl = document.querySelector('.theatre-git-status');
  if (!gitStatusEl) return;

  // Fetch dropdown info
  const info = await window.api.getGitDropdownInfo(projectPath);
  if (!info) return;

  // Create and insert dropdown as a child of git status for proper positioning
  const dropdownHtml = buildGitDropdownHtml(info);
  gitStatusEl.insertAdjacentHTML('beforeend', dropdownHtml);

  const dropdown = gitStatusEl.querySelector('.theatre-git-dropdown');
  if (!dropdown) return;

  // Wire up click handlers for branch switching
  dropdown.querySelectorAll('.git-dropdown-branch[data-branch]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const branchName = (el as HTMLElement).dataset.branch;
      if (branchName) {
        switchToBranch(branchName);
      }
    });
  });

  // Wire up click handler for uncommitted changes (diff viewer)
  const uncommittedEl = dropdown.querySelector('.git-dropdown-uncommitted--clickable');
  if (uncommittedEl) {
    uncommittedEl.addEventListener('click', (e) => {
      e.stopPropagation();
      hideGitDropdown();
      showDiffPanel();
    });
  }

  // Show with animation
  requestAnimationFrame(() => {
    dropdown.classList.add('visible');
  });

  gitDropdownVisible = true;

  // Set up click outside handler
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.theatre-git-status') && !target.closest('.theatre-git-dropdown')) {
      hideGitDropdown();
    }
  };

  // Use setTimeout to avoid immediately triggering from current click
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 0);

  gitDropdownCleanup = () => {
    document.removeEventListener('click', handleClickOutside);
  };
}

/**
 * Hide the git dropdown
 */
function hideGitDropdown(): void {
  if (!gitDropdownVisible) return;

  const gitStatusEl = document.querySelector('.theatre-git-status');
  const dropdown = gitStatusEl?.querySelector('.theatre-git-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
    // Remove after animation
    setTimeout(() => dropdown.remove(), 150);
  }

  if (gitDropdownCleanup) {
    gitDropdownCleanup();
    gitDropdownCleanup = null;
  }

  gitDropdownVisible = false;
}

/**
 * Toggle git dropdown visibility
 */
async function toggleGitDropdown(projectPath: string): Promise<void> {
  if (gitDropdownVisible) {
    hideGitDropdown();
  } else {
    await showGitDropdown(projectPath);
  }
}

/**
 * Build the theatre mode header content
 */
function buildTheatreHeader(projectData: Project, gitStatus: GitStatus | null): string {
  const icon = projectData.iconDataUrl
    ? `<img src="${projectData.iconDataUrl}" alt="" class="theatre-project-icon" />`
    : `<div class="theatre-project-icon theatre-project-icon--placeholder" style="background-color: ${stringToColor(projectData.name)}">${getInitials(projectData.name)}</div>`;

  const gitStatusHtml = buildGitStatusHtml(gitStatus);

  return `
    <div class="theatre-header-content">
      ${icon}
      <div class="theatre-project-info">
        <span class="theatre-project-name">${projectData.name}</span>
        <span class="theatre-project-path">${projectData.path}</span>
      </div>
      ${gitStatusHtml}
      <button class="theatre-exit-btn" title="Exit theatre mode (Esc)">
        <i data-lucide="minimize-2"></i>
      </button>
    </div>
  `;
}

/**
 * Update just the git status element in the theatre header
 */
function updateGitStatusElement(gitStatus: GitStatus | null): void {
  const headerContent = document.querySelector('.header-content');
  if (!headerContent) return;

  // Remove existing git status element
  const existingGitStatus = headerContent.querySelector('.theatre-git-status');
  if (existingGitStatus) {
    existingGitStatus.remove();
  }

  // If no git status, we're done
  if (!gitStatus) return;

  // Insert new git status before the exit button
  const exitBtn = headerContent.querySelector('.theatre-exit-btn');
  if (exitBtn) {
    const gitStatusHtml = buildGitStatusHtml(gitStatus);
    exitBtn.insertAdjacentHTML('beforebegin', gitStatusHtml);
    createIcons({ icons: theatreIcons, nodes: [headerContent as HTMLElement] });

    // Re-wire click handler for dropdown
    const gitStatusEl = headerContent.querySelector('.theatre-git-status');
    if (gitStatusEl && theatreModeProjectPath) {
      gitStatusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGitDropdown(theatreModeProjectPath!);
      });
    }
  }
}

/**
 * Refresh git status for the current theatre mode project
 */
async function refreshGitStatus(): Promise<void> {
  if (!theatreModeProjectPath) return;

  // Skip refreshing the status element if dropdown is open to avoid closing it
  // The dropdown content will be refreshed instead
  if (gitDropdownVisible) {
    const gitStatusEl = document.querySelector('.theatre-git-status');
    const dropdown = gitStatusEl?.querySelector('.theatre-git-dropdown');
    if (dropdown) {
      const info = await window.api.getGitDropdownInfo(theatreModeProjectPath);
      if (info) {
        // Build new dropdown content and replace inner HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = buildGitDropdownHtml(info);
        const newDropdown = tempDiv.firstElementChild;
        if (newDropdown) {
          dropdown.innerHTML = newDropdown.innerHTML;
        }
      }
    }
  } else {
    const gitStatus = await window.api.getGitStatus(theatreModeProjectPath);
    updateGitStatusElement(gitStatus);
  }
}

/**
 * Schedule a git status refresh after idle period
 */
function scheduleGitStatusRefresh(): void {
  // Clear any existing timeout
  if (gitStatusIdleTimeout) {
    clearTimeout(gitStatusIdleTimeout);
  }

  // Update last output time
  lastTerminalOutputTime = Date.now();

  // Schedule refresh after idle period
  gitStatusIdleTimeout = setTimeout(() => {
    refreshGitStatus();
  }, GIT_STATUS_IDLE_DELAY);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Build HTML for the diff panel
 */
function formatDiffStats(additions: number, deletions: number): string {
  const parts: string[] = [];
  if (additions > 0) parts.push(`<span class="diff-stat-add">+${additions}</span>`);
  if (deletions > 0) parts.push(`<span class="diff-stat-del">-${deletions}</span>`);
  return parts.length > 0 ? parts.join(' ') : '';
}

function buildDiffPanelHtml(files: ChangedFile[]): string {
  // Get first file for initial selector state
  const firstFile = files[0];
  const statusLabel = firstFile.status === '?' ? 'U' : firstFile.status;
  const fileName = firstFile.path.split('/').pop() || firstFile.path;
  const stats = formatDiffStats(firstFile.additions, firstFile.deletions);

  return `
    <div class="diff-panel">
      <div class="diff-content">
        <div class="diff-content-header">
          <div class="diff-file-selector" title="${escapeHtml(firstFile.path)}" data-additions="${firstFile.additions}" data-deletions="${firstFile.deletions}">
            <span class="diff-file-status diff-file-status--${statusLabel}">${statusLabel}</span>
            <span class="diff-file-selector-name">${escapeHtml(fileName)}</span>
            <span class="diff-file-selector-stats">${stats}</span>
            <i data-lucide="chevron-down" class="diff-file-selector-chevron"></i>
          </div>
          <span class="diff-header-info"></span>
          <button class="diff-panel-close" title="Close diff panel">&times;</button>
        </div>
        <div class="diff-content-body"></div>
      </div>
    </div>
  `;
}

/**
 * Build HTML for the file dropdown menu
 */
function buildDiffFileDropdownHtml(files: ChangedFile[], selectedPath: string): string {
  const items = files.map(file => {
    const statusLabel = file.status === '?' ? 'U' : file.status;
    const isSelected = file.path === selectedPath;
    const stats = formatDiffStats(file.additions, file.deletions);
    return `
      <div class="diff-file-dropdown-item${isSelected ? ' diff-file-dropdown-item--selected' : ''}" data-path="${escapeHtml(file.path)}" data-status="${file.status}" data-additions="${file.additions}" data-deletions="${file.deletions}">
        <span class="diff-file-status diff-file-status--${statusLabel}">${statusLabel}</span>
        <span class="diff-file-dropdown-name" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
        <span class="diff-file-dropdown-stats">${stats}</span>
      </div>
    `;
  }).join('');

  return `<div class="diff-file-dropdown">${items}</div>`;
}

/**
 * Show the file dropdown menu
 */
function showDiffFileDropdown(): void {
  if (diffFileDropdownVisible || !diffPanelSelectedFile) return;

  const panel = document.querySelector('.diff-panel');
  const selector = panel?.querySelector('.diff-file-selector');
  if (!selector) return;

  diffFileDropdownVisible = true;
  selector.classList.add('open');

  // Insert dropdown inside selector (like git dropdown pattern)
  const dropdownHtml = buildDiffFileDropdownHtml(diffPanelFiles, diffPanelSelectedFile);
  selector.insertAdjacentHTML('beforeend', dropdownHtml);

  const dropdown = selector.querySelector('.diff-file-dropdown');
  if (!dropdown) return;

  // Animate in
  requestAnimationFrame(() => {
    dropdown.classList.add('visible');
  });

  // Wire up item clicks
  dropdown.querySelectorAll('.diff-file-dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const filePath = (item as HTMLElement).dataset.path;
      if (filePath) {
        selectDiffFile(filePath);
      }
    });
  });

  // Set up click-outside handler
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!selector.contains(target)) {
      hideDiffFileDropdown();
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
    diffFileDropdownCleanup = () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, 0);
}

/**
 * Hide the file dropdown menu
 */
function hideDiffFileDropdown(): void {
  if (!diffFileDropdownVisible) return;

  diffFileDropdownVisible = false;

  const panel = document.querySelector('.diff-panel');
  const selector = panel?.querySelector('.diff-file-selector');
  const dropdown = selector?.querySelector('.diff-file-dropdown');

  selector?.classList.remove('open');

  if (dropdown) {
    dropdown.classList.remove('visible');
    setTimeout(() => dropdown.remove(), 150);
  }

  diffFileDropdownCleanup?.();
  diffFileDropdownCleanup = null;
}

/**
 * Toggle the file dropdown menu
 */
function toggleDiffFileDropdown(): void {
  if (diffFileDropdownVisible) {
    hideDiffFileDropdown();
  } else {
    showDiffFileDropdown();
  }
}

/**
 * Render diff content HTML from FileDiff
 */
function renderDiffContentHtml(diff: FileDiff): string {
  if (!diff.hunks.length) {
    return '<div class="diff-empty-state">No changes to display</div>';
  }

  const hunksHtml = diff.hunks.map(hunk => {
    const linesHtml = hunk.lines.map(line => {
      const oldNum = line.oldLineNo !== undefined ? line.oldLineNo : '';
      const newNum = line.newLineNo !== undefined ? line.newLineNo : '';
      return `
        <div class="diff-line diff-line--${line.type}">
          <div class="diff-line-numbers">
            <span class="diff-line-number">${oldNum}</span>
            <span class="diff-line-number">${newNum}</span>
          </div>
          <span class="diff-line-content">${escapeHtml(line.content)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="diff-hunk">
        <div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>
        ${linesHtml}
      </div>
    `;
  }).join('');

  return `<div class="diff-hunks-wrapper">${hunksHtml}</div>`;
}

/**
 * Select a file in the diff panel and show its diff
 */
async function selectDiffFile(filePath: string): Promise<void> {
  if (!theatreModeProjectPath) return;

  diffPanelSelectedFile = filePath;

  // Close dropdown if open
  hideDiffFileDropdown();

  const panel = document.querySelector('.diff-panel');
  if (!panel) return;

  // Update the selector trigger to show new file
  const file = diffPanelFiles.find(f => f.path === filePath);
  if (file) {
    const selector = panel.querySelector('.diff-file-selector');
    const statusEl = selector?.querySelector('.diff-file-status');
    const nameEl = selector?.querySelector('.diff-file-selector-name');
    const statsEl = selector?.querySelector('.diff-file-selector-stats');

    if (statusEl && nameEl && selector) {
      const statusLabel = file.status === '?' ? 'U' : file.status;
      statusEl.className = `diff-file-status diff-file-status--${statusLabel}`;
      statusEl.textContent = statusLabel;
      nameEl.textContent = file.path.split('/').pop() || file.path;
      (selector as HTMLElement).title = file.path;

      if (statsEl) {
        statsEl.innerHTML = formatDiffStats(file.additions, file.deletions);
      }
    }
  }

  // Clear header info while loading
  const headerInfo = panel.querySelector('.diff-header-info');
  if (headerInfo) headerInfo.textContent = '';

  // Fetch and render diff
  const contentBody = panel.querySelector('.diff-content-body');
  if (!contentBody) return;

  contentBody.innerHTML = '<div class="diff-empty-state">Loading...</div>';

  const diff = await window.api.getFileDiff(theatreModeProjectPath, filePath);
  if (diff) {
    contentBody.innerHTML = renderDiffContentHtml(diff);

    // Update header info with hunk count
    if (headerInfo && diff.hunks.length > 0) {
      const hunkText = diff.hunks.length === 1 ? '1 change' : `${diff.hunks.length} changes`;
      headerInfo.textContent = hunkText;
    }
  } else {
    contentBody.innerHTML = '<div class="diff-empty-state">Unable to load diff</div>';
  }
}

/**
 * Show the diff panel
 */
async function showDiffPanel(): Promise<void> {
  if (!theatreModeProjectPath || diffPanelVisible) return;

  // Fetch changed files
  const files = await window.api.getChangedFiles(theatreModeProjectPath);
  if (!files.length) {
    showToast('No uncommitted changes', 'info');
    return;
  }

  diffPanelFiles = files;
  diffPanelVisible = true;

  // Create and insert panel
  const panelHtml = buildDiffPanelHtml(files);
  document.body.insertAdjacentHTML('beforeend', panelHtml);

  const panel = document.querySelector('.diff-panel');
  if (!panel) return;

  // Initialize lucide icons for the chevron
  createIcons({ icons: theatreIcons });

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
    closeBtn.addEventListener('click', () => hideDiffPanel());
  }

  // Add class to terminal to shrink it
  const instance = theatreModeProjectPath ? terminals.get(theatreModeProjectPath) : null;
  if (instance) {
    instance.container.classList.add('diff-panel-open');
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Refit terminal after animation
  setTimeout(() => {
    if (instance) {
      instance.fitAddon.fit();
      if (instance.ptyId) {
        window.api.pty.resize(instance.ptyId, instance.terminal.cols, instance.terminal.rows);
      }
    }
  }, 250);

  // Select first file
  if (files.length > 0) {
    selectDiffFile(files[0].path);
  }
}

/**
 * Hide the diff panel
 */
function hideDiffPanel(): void {
  if (!diffPanelVisible) return;

  // Clean up file dropdown if open
  hideDiffFileDropdown();

  const panel = document.querySelector('.diff-panel');
  if (panel) {
    panel.classList.remove('diff-panel--visible');
    // Remove after animation
    setTimeout(() => panel.remove(), 250);
  }

  // Remove class from terminal
  const instance = theatreModeProjectPath ? terminals.get(theatreModeProjectPath) : null;
  if (instance) {
    instance.container.classList.remove('diff-panel-open');
  }

  // Refit terminal after animation
  setTimeout(() => {
    if (instance) {
      instance.fitAddon.fit();
      if (instance.ptyId) {
        window.api.pty.resize(instance.ptyId, instance.terminal.cols, instance.terminal.rows);
      }
    }
  }, 250);

  diffPanelVisible = false;
  diffPanelSelectedFile = null;
  diffPanelFiles = [];
}

/**
 * Enter theatre mode for the specified terminal
 */
export async function enterTheatreMode(projectPath: string, projectData: Project): Promise<void> {
  if (theatreModeProjectPath) return; // Already in theatre mode

  const instance = terminals.get(projectPath);
  if (!instance) return;

  // Fetch git status
  const gitStatus = projectData.hasGit ? await window.api.getGitStatus(projectPath) : null;

  // 1. Add class to body - CSS handles the rest
  document.body.classList.add('theatre-mode');

  // 2. Add class to terminal container
  instance.container.classList.add('terminal-accordion--theatre');

  // 3. Update theatre button icon to minimize
  const theatreBtn = instance.container.querySelector('.terminal-theatre-btn');
  if (theatreBtn) {
    theatreBtn.innerHTML = '<i data-lucide="minimize-2"></i>';
    theatreBtn.setAttribute('title', 'Exit theatre mode');
    createIcons({ icons: theatreIcons, nodes: [instance.container] });
  }

  // 4. Update header content
  const headerContent = document.querySelector('.header-content');
  if (headerContent) {
    originalHeaderContent = headerContent.innerHTML;
    headerContent.innerHTML = buildTheatreHeader(projectData, gitStatus);
    createIcons({ icons: theatreIcons, nodes: [headerContent as HTMLElement] });

    // Wire up exit button in header
    const exitBtn = headerContent.querySelector('.theatre-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => exitTheatreMode());
    }

    // Wire up git status click handler for dropdown
    const gitStatusEl = headerContent.querySelector('.theatre-git-status');
    if (gitStatusEl) {
      gitStatusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGitDropdown(projectPath);
      });
    }
  }

  // 5. Escape key handler
  escapeKeyHandler = (e) => { if (e.key === 'Escape') exitTheatreMode(); };
  document.addEventListener('keydown', escapeKeyHandler);

  // 6. Refit terminal
  requestAnimationFrame(() => {
    instance.fitAddon.fit();
    if (instance.ptyId) {
      window.api.pty.resize(instance.ptyId, instance.terminal.cols, instance.terminal.rows);
    }
    instance.terminal.focus();
  });

  theatreModeProjectPath = projectPath;
}

/**
 * Exit theatre mode
 */
export function exitTheatreMode(): void {
  if (!theatreModeProjectPath) return;

  const instance = terminals.get(theatreModeProjectPath);

  // 1. Remove class from body
  document.body.classList.remove('theatre-mode');

  // 2. Remove class from terminal
  if (instance) {
    instance.container.classList.remove('terminal-accordion--theatre');

    // Update theatre button icon back to maximize
    const theatreBtn = instance.container.querySelector('.terminal-theatre-btn');
    if (theatreBtn) {
      theatreBtn.innerHTML = '<i data-lucide="maximize-2"></i>';
      theatreBtn.setAttribute('title', 'Theatre mode');
      createIcons({ icons: theatreIcons, nodes: [instance.container] });
    }
  }

  // 3. Restore header content
  const headerContent = document.querySelector('.header-content');
  if (headerContent && originalHeaderContent) {
    headerContent.innerHTML = originalHeaderContent;
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
        const { showNewProjectDialog } = await import('./newProjectDialog');
        const result = await showNewProjectDialog();
        if (result?.created) {
          await (window as any).refreshProjects?.();
          const { showToast } = await import('./importDialog');
          showToast(`Created project: ${result.projectName}`, 'success');
        }
      });
    }
  }

  // 4. Remove escape handler
  if (escapeKeyHandler) {
    document.removeEventListener('keydown', escapeKeyHandler);
    escapeKeyHandler = null;
  }

  // 5. Clear git status idle timeout
  if (gitStatusIdleTimeout) {
    clearTimeout(gitStatusIdleTimeout);
    gitStatusIdleTimeout = null;
  }

  // 5b. Hide and cleanup git dropdown
  hideGitDropdown();

  // 5c. Hide diff panel
  hideDiffPanel();

  // 6. Refit terminal
  if (instance) {
    requestAnimationFrame(() => {
      instance.fitAddon.fit();
      if (instance.ptyId) {
        window.api.pty.resize(instance.ptyId, instance.terminal.cols, instance.terminal.rows);
      }
    });
  }

  originalHeaderContent = null;
  theatreModeProjectPath = null;
}

/**
 * Check if we're currently in theatre mode
 */
export function isInTheatreMode(): boolean {
  return theatreModeProjectPath !== null;
}
