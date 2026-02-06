/**
 * Diff panel for viewing uncommitted changes in theatre mode
 */

import type { ChangedFile, FileDiff } from '../../types';
import { theatreState, TheatreTerminal } from './state';
import { getTerminalGitPath, hideRunnerPanel, theatreRegistry } from './helpers';
import {
  projectPath,
  terminals,
  activeIndex,
  diffPanelVisible,
  diffPanelFiles,
  diffPanelSelectedFile,
  diffFileDropdownVisible,
  diffPanelMode,
  diffPanelWorktreeBranch,
} from './signals';
import { escapeHtml } from '../../utils/html';
import { showToast } from '../importDialog';

/**
 * Format diff stats as HTML
 */
export function formatDiffStats(additions: number, deletions: number): string {
  const parts: string[] = [];
  if (additions > 0) parts.push(`<span class="diff-stat-add">+${additions}</span>`);
  if (deletions > 0) parts.push(`<span class="diff-stat-del">-${deletions}</span>`);
  return parts.length > 0 ? parts.join(' ') : '';
}

/**
 * Build HTML for the diff panel (uncommitted changes only)
 */
export function buildDiffPanelHtml(files: ChangedFile[]): string {
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
          <button class="diff-panel-close" title="Close diff panel"><i data-lucide="chevron-right"></i></button>
        </div>
        <div class="diff-content-body"></div>
      </div>
    </div>
  `;
}

/**
 * Build HTML for the file dropdown menu
 */
export function buildDiffFileDropdownHtml(files: ChangedFile[], selectedPath: string): string {
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
 * Find the diff panel - either in the active terminal's card or in the document
 */
function findDiffPanel(): Element | null {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  // First try to find panel in active terminal's card
  if (currentTerminals.length > 0 && currentActiveIndex < currentTerminals.length) {
    const activeTerm = currentTerminals[currentActiveIndex];
    const panel = activeTerm.container.querySelector('.diff-panel');
    if (panel) return panel;
  }

  // Fallback to document-level panel (legacy)
  return document.querySelector('.diff-panel');
}

/**
 * Get the active terminal if it has a diff panel open
 */
function getActiveTerminalWithDiff(): TheatreTerminal | null {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length > 0 && currentActiveIndex < currentTerminals.length) {
    const activeTerm = currentTerminals[currentActiveIndex];
    if (activeTerm.diffPanelOpen) return activeTerm;
  }

  return null;
}

/**
 * Show the file dropdown menu
 */
export function showDiffFileDropdown(): void {
  if (diffFileDropdownVisible.value || !diffPanelSelectedFile.value) return;

  const panel = findDiffPanel();
  const selector = panel?.querySelector('.diff-file-selector');
  if (!selector) return;

  diffFileDropdownVisible.value = true;
  selector.classList.add('open');

  // Insert dropdown inside selector (like git dropdown pattern)
  const dropdownHtml = buildDiffFileDropdownHtml(diffPanelFiles.value, diffPanelSelectedFile.value);
  selector.insertAdjacentHTML('beforeend', dropdownHtml);

  const dropdown = selector.querySelector('.diff-file-dropdown');
  if (!dropdown) return;

  // Animate in
  requestAnimationFrame(() => {
    dropdown.classList.add('visible');
  });

  // Get terminal context for proper file selection
  const activeTerm = getActiveTerminalWithDiff();
  const isWorktreeMode = activeTerm?.diffPanelMode === 'worktree' || diffPanelMode.value === 'worktree';

  // Wire up item clicks
  dropdown.querySelectorAll('.diff-file-dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const filePath = (item as HTMLElement).dataset.path;
      if (filePath) {
        if (isWorktreeMode && activeTerm) {
          selectTerminalWorktreeDiffFile(activeTerm, filePath);
        } else if (activeTerm) {
          selectTerminalDiffFile(activeTerm, filePath);
        } else {
          selectDiffFile(filePath);
        }
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
    // Store cleanup in theatreState (non-reactive storage for cleanup functions)
    theatreState.diffFileDropdownCleanup = () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, 0);
}

/**
 * Hide the file dropdown menu
 */
export function hideDiffFileDropdown(): void {
  if (!diffFileDropdownVisible.value) return;

  diffFileDropdownVisible.value = false;

  const panel = findDiffPanel();
  const selector = panel?.querySelector('.diff-file-selector');
  const dropdown = selector?.querySelector('.diff-file-dropdown');

  selector?.classList.remove('open');

  if (dropdown) {
    dropdown.classList.remove('visible');
    setTimeout(() => dropdown.remove(), 150);
  }

  theatreState.diffFileDropdownCleanup?.();
  theatreState.diffFileDropdownCleanup = null;
}

/**
 * Toggle the file dropdown menu
 */
export function toggleDiffFileDropdown(): void {
  if (diffFileDropdownVisible.value) {
    hideDiffFileDropdown();
  } else {
    showDiffFileDropdown();
  }
}

/**
 * Render diff content HTML from FileDiff
 */
export function renderDiffContentHtml(diff: FileDiff): string {
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
export async function selectDiffFile(filePath: string): Promise<void> {
  if (!projectPath.value) return;

  diffPanelSelectedFile.value = filePath;

  // Close dropdown if open
  hideDiffFileDropdown();

  const panel = document.querySelector('.diff-panel');
  if (!panel) return;

  // Update the selector trigger to show new file
  const file = diffPanelFiles.value.find(f => f.path === filePath);
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

  // Clear header info while loading (but preserve "vs main" for worktree mode)
  const headerInfo = panel.querySelector('.diff-header-info');
  if (headerInfo && diffPanelMode.value !== 'worktree') {
    headerInfo.textContent = '';
  }

  // Fetch and render diff
  const contentBody = panel.querySelector('.diff-content-body');
  if (!contentBody) return;

  contentBody.innerHTML = '<div class="diff-empty-state">Loading...</div>';

  // Use appropriate API based on mode
  let diff: FileDiff | null = null;
  if (diffPanelMode.value === 'worktree' && diffPanelWorktreeBranch.value) {
    diff = await window.api.worktree.getFileDiff(
      projectPath.value!,
      diffPanelWorktreeBranch.value,
      filePath
    );
  } else {
    diff = await window.api.getFileDiff(projectPath.value!, filePath);
  }

  if (diff) {
    contentBody.innerHTML = renderDiffContentHtml(diff);

    // Update header info with hunk count (but keep "vs main" for worktree mode)
    if (headerInfo && diff.hunks.length > 0 && diffPanelMode.value !== 'worktree') {
      const hunkText = diff.hunks.length === 1 ? '1 change' : `${diff.hunks.length} changes`;
      headerInfo.textContent = hunkText;
    }
  } else {
    contentBody.innerHTML = '<div class="diff-empty-state">Unable to load diff</div>';
  }
}

/**
 * Refit the active terminal after panel animation
 */
function refitActiveTerminal(): void {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;
  if (currentTerminals.length > 0 && currentActiveIndex < currentTerminals.length) {
    const active = currentTerminals[currentActiveIndex];
    active.fitAddon.fit();
    window.api.pty.resize(active.ptyId, active.terminal.cols, active.terminal.rows);
  }
}

/**
 * Show the diff panel
 */
export async function showDiffPanel(): Promise<void> {
  if (!projectPath.value || diffPanelVisible.value) return;

  // Fetch changed files
  const files = await window.api.getChangedFiles(projectPath.value);
  if (!files.length) {
    showToast('No uncommitted changes', 'info');
    return;
  }

  diffPanelFiles.value = files;
  diffPanelVisible.value = true;

  // Create and insert panel
  const panelHtml = buildDiffPanelHtml(files);
  document.body.insertAdjacentHTML('beforeend', panelHtml);

  const panel = document.querySelector('.diff-panel');
  if (!panel) return;

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

  // Add class to theatre stack to shrink it
  const stack = document.querySelector('.theatre-stack');
  if (stack) {
    stack.classList.add('diff-panel-open');
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Refit active theatre terminal after animation
  setTimeout(() => refitActiveTerminal(), 250);

  // Select first file
  if (files.length > 0) {
    selectDiffFile(files[0].path);
  }
}

/**
 * Hide the diff panel
 */
export function hideDiffPanel(): void {
  if (!diffPanelVisible.value) return;

  // Clean up file dropdown if open
  hideDiffFileDropdown();

  const panel = document.querySelector('.diff-panel');
  if (panel) {
    panel.classList.remove('diff-panel--visible');
    // Remove after animation
    setTimeout(() => panel.remove(), 250);
  }

  // Remove class from theatre stack
  const stack = document.querySelector('.theatre-stack');
  if (stack) {
    stack.classList.remove('diff-panel-open');
  }

  // Refit active theatre terminal after animation
  setTimeout(() => refitActiveTerminal(), 250);

  diffPanelVisible.value = false;
  diffPanelSelectedFile.value = null;
  diffPanelFiles.value = [];
  diffPanelMode.value = 'uncommitted';
  diffPanelWorktreeBranch.value = null;
}

/**
 * Toggle the diff panel visibility
 */
export async function toggleDiffPanel(): Promise<void> {
  if (diffPanelVisible.value) {
    hideDiffPanel();
  } else {
    await showDiffPanel();
  }
}

/**
 * Show the diff panel for a specific terminal
 */
export async function showTerminalDiffPanel(term: TheatreTerminal): Promise<void> {
  if (term.diffPanelOpen) return;

  // Close runner panel if open (mutual exclusivity)
  if (term.runnerPanelOpen) {
    hideRunnerPanel(term);
  }

  const gitPath = getTerminalGitPath(term);

  // Fetch changed files for this terminal's git context
  const files = await window.api.getChangedFiles(gitPath);
  if (!files.length) {
    showToast('No uncommitted changes', 'info');
    return;
  }

  // Store state on the terminal
  term.diffPanelOpen = true;
  term.diffPanelFiles = files;
  term.diffPanelMode = 'uncommitted';

  // Also update global signals for compatibility
  diffPanelFiles.value = files;
  diffPanelVisible.value = true;
  diffPanelMode.value = 'uncommitted';

  // Find the card body to insert the diff panel
  const cardBody = term.container.querySelector('.theatre-card-body');
  if (!cardBody) return;

  // Hide the terminal viewport (full width panel like ship panel)
  const viewport = cardBody.querySelector('.terminal-viewport') as HTMLElement;
  if (viewport) {
    viewport.style.display = 'none';
  }

  // Create and insert panel inside the card body
  const panelHtml = buildDiffPanelHtml(files);
  cardBody.insertAdjacentHTML('beforeend', panelHtml);

  const panel = cardBody.querySelector('.diff-panel');
  if (!panel) return;

  // Add class to card to indicate diff is open
  term.container.classList.add('diff-panel-open');

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
    closeBtn.addEventListener('click', () => hideTerminalDiffPanel(term));
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Select first file
  if (files.length > 0) {
    await selectTerminalDiffFile(term, files[0].path);
  }
}

/**
 * Hide the diff panel for a specific terminal
 */
export function hideTerminalDiffPanel(term: TheatreTerminal): void {
  if (!term.diffPanelOpen) return;

  // Clean up file dropdown if open
  hideDiffFileDropdown();

  // Find the panel inside the card
  const panel = term.container.querySelector('.diff-panel');
  if (panel) {
    panel.classList.remove('diff-panel--visible');
    // Remove after animation and restore terminal viewport
    setTimeout(() => {
      panel.remove();

      // Show the terminal viewport again
      const cardBody = term.container.querySelector('.theatre-card-body');
      const viewport = cardBody?.querySelector('.terminal-viewport') as HTMLElement;
      if (viewport) {
        viewport.style.display = '';
      }

      // Refit terminal
      requestAnimationFrame(() => {
        term.fitAddon.fit();
        window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
        term.terminal.focus();
      });
    }, 250);
  }

  // Remove class from card
  term.container.classList.remove('diff-panel-open');

  // Update terminal state
  term.diffPanelOpen = false;
  term.diffPanelSelectedFile = null;
  term.diffPanelFiles = [];
  term.diffPanelMode = 'uncommitted';

  // Update global signals
  diffPanelVisible.value = false;
  diffPanelSelectedFile.value = null;
  diffPanelFiles.value = [];
  diffPanelMode.value = 'uncommitted';
  diffPanelWorktreeBranch.value = null;
}

/**
 * Toggle the diff panel for a specific terminal
 */
export async function toggleTerminalDiffPanel(term: TheatreTerminal): Promise<void> {
  if (term.diffPanelOpen) {
    hideTerminalDiffPanel(term);
  } else {
    await showTerminalDiffPanel(term);
  }
}

/**
 * Select a file in the diff panel for a specific terminal
 */
export async function selectTerminalDiffFile(term: TheatreTerminal, filePath: string): Promise<void> {
  const gitPath = getTerminalGitPath(term);

  term.diffPanelSelectedFile = filePath;
  diffPanelSelectedFile.value = filePath;

  // Close dropdown if open
  hideDiffFileDropdown();

  // Find the panel inside the terminal's card
  const panel = term.container.querySelector('.diff-panel');
  if (!panel) return;

  // Update the selector trigger to show new file
  const file = term.diffPanelFiles.find(f => f.path === filePath);
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

  // Clear header info while loading (but preserve "vs main" for worktree mode)
  const headerInfo = panel.querySelector('.diff-header-info');
  if (headerInfo && term.diffPanelMode !== 'worktree') {
    headerInfo.textContent = '';
  }

  // Fetch and render diff
  const contentBody = panel.querySelector('.diff-content-body');
  if (!contentBody) return;

  contentBody.innerHTML = '<div class="diff-empty-state">Loading...</div>';

  // Use the terminal's git path
  const diff = await window.api.getFileDiff(gitPath, filePath);

  if (diff) {
    contentBody.innerHTML = renderDiffContentHtml(diff);

    // Update header info with hunk count (but keep "vs main" for worktree mode)
    if (headerInfo && diff.hunks.length > 0 && term.diffPanelMode !== 'worktree') {
      const hunkText = diff.hunks.length === 1 ? '1 change' : `${diff.hunks.length} changes`;
      headerInfo.textContent = hunkText;
    }
  } else {
    contentBody.innerHTML = '<div class="diff-empty-state">Unable to load diff</div>';
  }
}

/**
 * Sync the diff panel visibility based on the active terminal's state
 * Called when switching terminals - updates global signals to reflect active terminal
 * The diff panel DOM is now inside each card, so it moves with the card
 */
export function syncDiffPanelToActiveTerminal(): void {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length === 0 || currentActiveIndex >= currentTerminals.length) {
    return;
  }

  const activeTerm = currentTerminals[currentActiveIndex];

  // Update global signals to match active terminal's state
  if (activeTerm.diffPanelOpen) {
    diffPanelFiles.value = activeTerm.diffPanelFiles;
    diffPanelSelectedFile.value = activeTerm.diffPanelSelectedFile;
    diffPanelVisible.value = true;
  } else {
    diffPanelVisible.value = false;
    diffPanelFiles.value = [];
    diffPanelSelectedFile.value = null;
  }

  // Only refit if the active terminal has a diff panel open (which changes terminal width)
  if (activeTerm.diffPanelOpen) {
    setTimeout(() => refitActiveTerminal(), 50);
  }
}

/**
 * Show the diff panel for a worktree branch (branch comparison mode) - LEGACY global version
 * @deprecated Use showTerminalWorktreeDiffPanel for per-terminal worktree diff
 */
export async function showWorktreeDiffPanel(worktreeBranch: string): Promise<void> {
  if (!projectPath.value || diffPanelVisible.value) return;

  // Fetch worktree diff
  const diffSummary = await window.api.worktree.getDiff(projectPath.value, worktreeBranch);
  if (!diffSummary || !diffSummary.files.length) {
    showToast('No changes in worktree branch', 'info');
    return;
  }

  // Set mode before showing panel
  diffPanelMode.value = 'worktree';
  diffPanelWorktreeBranch.value = worktreeBranch;
  diffPanelFiles.value = diffSummary.files;
  diffPanelVisible.value = true;

  // Create and insert panel
  const panelHtml = buildDiffPanelHtml(diffSummary.files);
  document.body.insertAdjacentHTML('beforeend', panelHtml);

  const panel = document.querySelector('.diff-panel');
  if (!panel) return;

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

  // Add class to theatre stack to shrink it
  const stack = document.querySelector('.theatre-stack');
  if (stack) {
    stack.classList.add('diff-panel-open');
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Refit active theatre terminal after animation
  setTimeout(() => refitActiveTerminal(), 250);

  // Select first file
  if (diffSummary.files.length > 0) {
    selectDiffFile(diffSummary.files[0].path);
  }
}

/**
 * Show the worktree diff panel for a specific terminal (branch vs main comparison)
 * Shows changes between the worktree branch and main, inside the terminal's card
 */
export async function showTerminalWorktreeDiffPanel(term: TheatreTerminal): Promise<void> {
  if (term.diffPanelOpen || !term.isWorktree || !term.worktreeBranch) return;

  // Close runner panel if open (mutual exclusivity)
  if (term.runnerPanelOpen) {
    hideRunnerPanel(term);
  }

  const basePath = projectPath.value;
  if (!basePath) return;

  // Fetch worktree diff (branch vs main)
  const diffSummary = await window.api.worktree.getDiff(basePath, term.worktreeBranch);
  if (!diffSummary || !diffSummary.files.length) {
    showToast('No changes in worktree branch', 'info');
    return;
  }

  // Store state on the terminal
  term.diffPanelOpen = true;
  term.diffPanelFiles = diffSummary.files;
  term.diffPanelMode = 'worktree';

  // Also update global signals for compatibility
  diffPanelFiles.value = diffSummary.files;
  diffPanelVisible.value = true;
  diffPanelMode.value = 'worktree';
  diffPanelWorktreeBranch.value = term.worktreeBranch;

  // Find the card body to insert the diff panel
  const cardBody = term.container.querySelector('.theatre-card-body');
  if (!cardBody) return;

  // Hide the terminal viewport (full width panel like ship panel)
  const viewport = cardBody.querySelector('.terminal-viewport') as HTMLElement;
  if (viewport) {
    viewport.style.display = 'none';
  }

  // Create and insert panel inside the card body
  const panelHtml = buildDiffPanelHtml(diffSummary.files);
  cardBody.insertAdjacentHTML('beforeend', panelHtml);

  const panel = cardBody.querySelector('.diff-panel');
  if (!panel) return;

  // Add class to card to indicate diff is open
  term.container.classList.add('diff-panel-open');

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
    closeBtn.addEventListener('click', () => hideTerminalDiffPanel(term));
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Select first file
  if (diffSummary.files.length > 0) {
    await selectTerminalWorktreeDiffFile(term, diffSummary.files[0].path);
  }
}

/**
 * Select a file in the worktree diff panel for a specific terminal
 */
export async function selectTerminalWorktreeDiffFile(term: TheatreTerminal, filePath: string): Promise<void> {
  if (!term.isWorktree || !term.worktreeBranch) return;

  const basePath = projectPath.value;
  if (!basePath) return;

  term.diffPanelSelectedFile = filePath;
  diffPanelSelectedFile.value = filePath;

  // Close dropdown if open
  hideDiffFileDropdown();

  // Find the panel inside the terminal's card
  const panel = term.container.querySelector('.diff-panel');
  if (!panel) return;

  // Update the selector trigger to show new file
  const file = term.diffPanelFiles.find(f => f.path === filePath);
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

  // Fetch and render diff
  const contentBody = panel.querySelector('.diff-content-body');
  if (!contentBody) return;

  contentBody.innerHTML = '<div class="diff-empty-state">Loading...</div>';

  // Use worktree API to get diff vs main
  const diff = await window.api.worktree.getFileDiff(basePath, term.worktreeBranch, filePath);

  if (diff) {
    contentBody.innerHTML = renderDiffContentHtml(diff);
    // Keep header info as "vs main" for worktree diffs
  } else {
    contentBody.innerHTML = '<div class="diff-empty-state">Unable to load diff</div>';
  }
}

/**
 * Toggle the worktree diff panel for a specific terminal
 */
export async function toggleTerminalWorktreeDiffPanel(term: TheatreTerminal): Promise<void> {
  if (term.diffPanelOpen) {
    hideTerminalDiffPanel(term);
  } else {
    await showTerminalWorktreeDiffPanel(term);
  }
}

/**
 * Toggle diff panel for the active terminal (hotkey handler)
 */
async function toggleActiveDiffPanel(): Promise<void> {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length === 0 || currentActiveIndex >= currentTerminals.length) {
    return;
  }

  const activeTerm = currentTerminals[currentActiveIndex];
  await toggleTerminalDiffPanel(activeTerm);
}

// Register in theatre registry for cross-module access
theatreRegistry.toggleActiveDiffPanel = toggleActiveDiffPanel;
