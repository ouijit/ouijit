/**
 * Diff panel for viewing uncommitted changes in theatre mode
 */

import { createIcons, ChevronDown } from 'lucide';
import type { ChangedFile, FileDiff } from '../../types';
import { theatreState } from './state';
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

const diffIcons = { ChevronDown };

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
 * Build HTML for the diff panel
 */
export function buildDiffPanelHtml(files: ChangedFile[], worktreeBranch?: string): string {
  // Get first file for initial selector state
  const firstFile = files[0];
  const statusLabel = firstFile.status === '?' ? 'U' : firstFile.status;
  const fileName = firstFile.path.split('/').pop() || firstFile.path;
  const stats = formatDiffStats(firstFile.additions, firstFile.deletions);

  // Context label for worktree mode
  const contextLabel = worktreeBranch
    ? `<span class="diff-context-label">${escapeHtml(worktreeBranch)} vs main</span>`
    : '';

  return `
    <div class="diff-panel">
      <div class="diff-content">
        <div class="diff-content-header">
          ${contextLabel}
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
 * Show the file dropdown menu
 */
export function showDiffFileDropdown(): void {
  if (diffFileDropdownVisible.value || !diffPanelSelectedFile.value) return;

  const panel = document.querySelector('.diff-panel');
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

  const panel = document.querySelector('.diff-panel');
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

  // Clear header info while loading
  const headerInfo = panel.querySelector('.diff-header-info');
  if (headerInfo) headerInfo.textContent = '';

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

  // Initialize lucide icons for the chevron
  createIcons({ icons: diffIcons });

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
 * Show the diff panel for a worktree branch (branch comparison mode)
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

  // Create and insert panel with worktree context
  const panelHtml = buildDiffPanelHtml(diffSummary.files, worktreeBranch);
  document.body.insertAdjacentHTML('beforeend', panelHtml);

  const panel = document.querySelector('.diff-panel');
  if (!panel) return;

  // Initialize lucide icons for the chevron
  createIcons({ icons: diffIcons });

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
