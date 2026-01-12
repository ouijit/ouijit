import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { createIcons, Maximize2, Minimize2, RefreshCw, GitBranch } from 'lucide';
import type { PtyId, PtySpawnOptions, Project, GitStatus, GitDropdownInfo } from '../types';
import { stringToColor, getInitials } from '../utils/projectIcon';

const theatreIcons = { Maximize2, Minimize2, RefreshCw, GitBranch };

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
  terminal.open(viewport);

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

  // Set up resize observer
  instance.resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (instance.ptyId) {
      window.api.pty.resize(instance.ptyId, terminal.cols, terminal.rows);
    }
  });
  instance.resizeObserver.observe(viewport);

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
    uncommittedHtml = `<div class="git-dropdown-uncommitted">${parts.join(' \u00B7 ')}</div>`;
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
 * Switch to a branch by writing git checkout command to the terminal
 */
function switchToBranch(branchName: string): void {
  if (!theatreModeProjectPath) return;

  const instance = terminals.get(theatreModeProjectPath);
  if (!instance?.ptyId) return;

  // Write git checkout command to terminal
  window.api.pty.write(instance.ptyId, `git checkout ${branchName}\n`);

  // Close dropdown
  hideGitDropdown();
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

  const gitStatus = await window.api.getGitStatus(theatreModeProjectPath);
  updateGitStatusElement(gitStatus);

  // Also refresh dropdown content if it's visible
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
