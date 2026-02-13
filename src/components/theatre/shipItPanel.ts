/**
 * Ship-It Panel - Full-width panel for reviewing and merging worktree branches
 */

import type { ChangedFile, FileDiff, ShipItResult, BranchInfo } from '../../types';
import { TheatreTerminal } from './state';
import { theatreRegistry, hideRunnerPanel } from './helpers';
import { projectPath, terminals, activeIndex, invalidateTaskList } from './signals';
import { escapeHtml } from '../../utils/html';
import { showToast } from '../importDialog';
import { formatDiffStats, renderDiffContentHtml, hideDiffFileDropdown, buildDiffFileDropdownHtml } from './diffPanel';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes, platformHotkey } from '../../utils/hotkeys';

/**
 * Build HTML for the Ship-It panel
 * @param uncommittedCount - Number of uncommitted files (0 if none, disables merge when > 0)
 * @param showingUncommitted - Whether we're displaying uncommitted changes (vs committed branch diff)
 * @param mergeTarget - Branch to merge into
 */
function buildShipItPanelHtml(
  branchName: string,
  files: ChangedFile[],
  totalAdditions: number,
  totalDeletions: number,
  uncommittedCount: number = 0,
  showingUncommitted: boolean = false,
  mergeTarget: string = 'main'
): string {
  const displayBranch = branchName.length > 30
    ? branchName.slice(0, 27) + '...'
    : branchName;

  // Build file list HTML
  const fileListHtml = files.map(file => {
    const statusLabel = file.status === '?' ? 'U' : file.status;
    const stats = formatDiffStats(file.additions, file.deletions);
    return `
      <div class="ship-it-file" data-path="${escapeHtml(file.path)}" data-status="${file.status}" data-additions="${file.additions}" data-deletions="${file.deletions}">
        <span class="diff-file-status diff-file-status--${statusLabel}">${statusLabel}</span>
        <span class="ship-it-file-name" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
        <span class="ship-it-file-stats">${stats}</span>
      </div>
    `;
  }).join('');

  // Header title - show warning if uncommitted changes, otherwise ready state
  const headerTitle = uncommittedCount > 0
    ? `${uncommittedCount} uncommitted file${uncommittedCount !== 1 ? 's' : ''} — commit to merge`
    : 'Ready to merge';

  // Summary branch section - only show "Uncommitted changes" if we're showing uncommitted files
  const branchSummary = showingUncommitted
    ? `<span class="ship-it-uncommitted-label">Uncommitted changes</span>`
    : `${escapeHtml(branchName)} <i data-lucide="arrow-right"></i> <span class="ship-it-merge-target" title="Click to change target branch">${escapeHtml(mergeTarget)}<i data-lucide="chevron-down"></i></span>`;

  return `
    <div class="ship-it-panel${uncommittedCount > 0 ? ' ship-it-panel--uncommitted' : ''}">
      <div class="ship-it-header${uncommittedCount > 0 ? ' ship-it-header--warning' : ''}">
        <span class="ship-it-title">${headerTitle}</span>
        <button class="ship-it-close" title="Close panel"><i data-lucide="chevron-right"></i></button>
      </div>
      <div class="ship-it-body">
        <div class="ship-it-left">
          <div class="ship-it-summary">
            <div class="ship-it-summary-stat">
              <span class="ship-it-summary-value">${files.length}</span>
              <span class="ship-it-summary-label">file${files.length !== 1 ? 's' : ''} changed</span>
            </div>
            <div class="ship-it-summary-stat">
              <span class="ship-it-summary-value ship-it-add">+${totalAdditions}</span>
              <span class="ship-it-summary-label">/</span>
              <span class="ship-it-summary-value ship-it-del">-${totalDeletions}</span>
            </div>
            <div class="ship-it-summary-branch">
              ${branchSummary}
            </div>
          </div>
          <div class="ship-it-file-list">
            ${fileListHtml}
          </div>
        </div>
        <div class="ship-it-right">
          <div class="ship-it-diff-header">
            <div class="ship-it-diff-file-selector" title="">
              <span class="diff-file-status"></span>
              <span class="ship-it-diff-file-name"></span>
              <span class="ship-it-diff-file-stats"></span>
              <i data-lucide="chevron-down" class="diff-file-selector-chevron"></i>
            </div>
          </div>
          <div class="ship-it-diff-content">
            <div class="diff-empty-state">Select a file to view diff</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Show the Ship-It panel for a terminal
 */
export async function showShipItPanel(term: TheatreTerminal): Promise<void> {
  if (term.taskId == null || !term.worktreeBranch) {
    showToast('Ship-It is only available for worktree tasks', 'info');
    return;
  }

  const basePath = projectPath.value;
  if (!basePath) return;

  // Check if panel already open - if so, this is a ship action
  const existingPanel = term.container.querySelector('.ship-it-panel') as HTMLElement;
  if (existingPanel) {
    // Check if shipping is allowed (no uncommitted changes)
    const shipBtn = term.container.querySelector('.theatre-card-ship-btn') as HTMLElement;
    if (shipBtn?.dataset.canShip === 'true') {
      showCommitDialog(term, existingPanel);
    }
    return;
  }

  // Close runner panel if open
  if (term.runnerPanelOpen) {
    hideRunnerPanel(term);
  }

  // Close diff panel if open
  if (term.diffPanelOpen) {
    const { hideTerminalDiffPanel } = await import('./diffPanel');
    hideTerminalDiffPanel(term);
  }

  // Get task metadata to find merge target
  const tasks = await window.api.task.getAll(basePath);
  const task = tasks.find(t => t.taskNumber === term.taskId);

  // Get main branch as fallback
  const mainBranch = await window.api.worktree.getMainBranch(basePath);
  const mergeTarget = task?.mergeTarget || mainBranch;

  // Fetch worktree diff (branch vs target)
  const diffSummary = await window.api.worktree.getDiff(basePath, term.worktreeBranch, mergeTarget);

  let files: ChangedFile[] = diffSummary?.files || [];
  let uncommittedCount = 0;
  let showingUncommitted = false;

  // Always check for uncommitted changes in the worktree
  if (term.worktreePath) {
    const uncommittedFiles = await window.api.getChangedFiles(term.worktreePath);
    uncommittedCount = uncommittedFiles.length;
    if (uncommittedCount > 0) {
      // If no committed changes, show uncommitted changes instead
      if (files.length === 0) {
        files = uncommittedFiles;
        showingUncommitted = true;
      }
    }
  }

  if (files.length === 0) {
    showToast('No changes to ship', 'info');
    return;
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Build and insert panel
  const cardBody = term.container.querySelector('.theatre-card-body');
  if (!cardBody) return;

  // Hide the terminal viewport
  const viewport = cardBody.querySelector('.terminal-viewport') as HTMLElement;
  if (viewport) {
    viewport.style.display = 'none';
  }

  // Insert the Ship-It panel
  const panelHtml = buildShipItPanelHtml(
    term.worktreeBranch,
    files,
    totalAdditions,
    totalDeletions,
    uncommittedCount,
    showingUncommitted,
    mergeTarget
  );
  cardBody.insertAdjacentHTML('beforeend', panelHtml);

  const panel = cardBody.querySelector('.ship-it-panel') as HTMLElement;
  if (!panel) return;

  // Store state
  const panelState: ShipItPanelState = {
    files,
    showingUncommitted,
    selectedFile: null,
    dropdownOpen: false,
    dropdownCleanup: null,
    mergeTarget,
    branchDropdownOpen: false,
    branchDropdownCleanup: null,
    availableBranches: [],
  };

  // Wire up close button
  const closeBtn = panel.querySelector('.ship-it-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => hideShipItPanel(term));
  }

  // Update ship button in header - only expand to CTA when ready to merge
  const shipBtn = term.container.querySelector('.theatre-card-ship-btn') as HTMLElement;
  if (shipBtn) {
    const canMerge = uncommittedCount === 0;
    shipBtn.dataset.canShip = canMerge ? 'true' : 'false';
    if (canMerge) {
      // Ready to merge - expand to full CTA
      shipBtn.classList.add('theatre-card-ship-btn--expanded');
      shipBtn.innerHTML = `<i data-lucide="rocket"></i><span>Merge to ${escapeHtml(mergeTarget)}</span>`;
    }
    // If not ready, button stays as-is (just the rocket icon)
  }

  // Wire up merge target click
  const mergeTargetEl = panel.querySelector('.ship-it-merge-target');
  if (mergeTargetEl) {
    mergeTargetEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMergeTargetDropdown(term, panel, panelState);
    });
  }

  // Wire up file list clicks
  const fileList = panel.querySelector('.ship-it-file-list');
  if (fileList) {
    fileList.querySelectorAll('.ship-it-file').forEach(fileEl => {
      fileEl.addEventListener('click', () => {
        const path = (fileEl as HTMLElement).dataset.path;
        if (path) {
          selectShipItFile(term, panel, path, panelState);
        }
      });
    });
  }

  // Wire up file selector dropdown
  const fileSelector = panel.querySelector('.ship-it-diff-file-selector');
  if (fileSelector) {
    fileSelector.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panelState.selectedFile) {
        toggleShipItFileDropdown(term, panel, panelState);
      }
    });
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('ship-it-panel--visible');
  });

  // Select first file
  if (files.length > 0) {
    await selectShipItFile(term, panel, files[0].path, panelState);
  }
}

// Panel state type
interface ShipItPanelState {
  files: ChangedFile[];
  showingUncommitted: boolean;
  selectedFile: string | null;
  dropdownOpen: boolean;
  dropdownCleanup: (() => void) | null;
  mergeTarget: string;
  branchDropdownOpen: boolean;
  branchDropdownCleanup: (() => void) | null;
  availableBranches: BranchInfo[];
}

/**
 * Select a file in the Ship-It panel and show its diff
 */
async function selectShipItFile(
  term: TheatreTerminal,
  panel: HTMLElement,
  filePath: string,
  state: ShipItPanelState
): Promise<void> {
  if (!term.worktreeBranch) return;

  const basePath = projectPath.value;
  if (!basePath) return;

  state.selectedFile = filePath;

  // Close dropdown if open
  if (state.dropdownOpen) {
    hideShipItFileDropdown(panel, state);
  }

  // Update file list selection
  panel.querySelectorAll('.ship-it-file').forEach(el => {
    el.classList.toggle('ship-it-file--selected', (el as HTMLElement).dataset.path === filePath);
  });

  // Find file info
  const file = state.files.find(f => f.path === filePath);
  if (!file) return;

  // Update file selector header
  const selector = panel.querySelector('.ship-it-diff-file-selector');
  const statusEl = selector?.querySelector('.diff-file-status');
  const nameEl = selector?.querySelector('.ship-it-diff-file-name');
  const statsEl = selector?.querySelector('.ship-it-diff-file-stats');

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

  // Fetch and render diff
  const diffContent = panel.querySelector('.ship-it-diff-content');
  if (!diffContent) return;

  diffContent.innerHTML = '<div class="diff-empty-state">Loading...</div>';

  // Use different diff API based on mode
  let diff: FileDiff | null;
  if (state.showingUncommitted && term.worktreePath) {
    // Uncommitted changes - use worktree path
    diff = await window.api.getFileDiff(term.worktreePath, filePath);
  } else {
    // Committed branch diff - use merge target
    diff = await window.api.worktree.getFileDiff(basePath, term.worktreeBranch, filePath, state.mergeTarget);
  }

  if (diff) {
    diffContent.innerHTML = renderDiffContentHtml(diff);
  } else {
    diffContent.innerHTML = '<div class="diff-empty-state">Unable to load diff</div>';
  }
}

/**
 * Toggle file dropdown in Ship-It panel
 */
function toggleShipItFileDropdown(
  term: TheatreTerminal,
  panel: HTMLElement,
  state: ShipItPanelState
): void {
  if (state.dropdownOpen) {
    hideShipItFileDropdown(panel, state);
  } else {
    showShipItFileDropdown(term, panel, state);
  }
}

/**
 * Show file dropdown in Ship-It panel
 */
function showShipItFileDropdown(
  term: TheatreTerminal,
  panel: HTMLElement,
  state: ShipItPanelState
): void {
  if (state.dropdownOpen || !state.selectedFile) return;

  const selector = panel.querySelector('.ship-it-diff-file-selector');
  if (!selector) return;

  state.dropdownOpen = true;
  selector.classList.add('open');

  // Build and insert dropdown
  const dropdownHtml = buildDiffFileDropdownHtml(state.files, state.selectedFile);
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
      const path = (item as HTMLElement).dataset.path;
      if (path) {
        selectShipItFile(term, panel, path, state);
      }
    });
  });

  // Click-outside handler
  const handleClickOutside = (e: MouseEvent) => {
    if (!selector.contains(e.target as Node)) {
      hideShipItFileDropdown(panel, state);
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
    state.dropdownCleanup = () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, 0);
}

/**
 * Hide file dropdown in Ship-It panel
 */
function hideShipItFileDropdown(
  panel: HTMLElement,
  state: { dropdownOpen: boolean; dropdownCleanup: (() => void) | null }
): void {
  if (!state.dropdownOpen) return;

  state.dropdownOpen = false;

  const selector = panel.querySelector('.ship-it-diff-file-selector');
  const dropdown = selector?.querySelector('.diff-file-dropdown');

  selector?.classList.remove('open');

  if (dropdown) {
    dropdown.classList.remove('visible');
    setTimeout(() => dropdown.remove(), 150);
  }

  state.dropdownCleanup?.();
  state.dropdownCleanup = null;
}

/**
 * Toggle merge target dropdown
 */
function toggleMergeTargetDropdown(
  term: TheatreTerminal,
  panel: HTMLElement,
  state: ShipItPanelState
): void {
  if (state.branchDropdownOpen) {
    hideMergeTargetDropdown(panel, state);
  } else {
    showMergeTargetDropdown(term, panel, state);
  }
}

/**
 * Show merge target dropdown
 */
async function showMergeTargetDropdown(
  term: TheatreTerminal,
  panel: HTMLElement,
  state: ShipItPanelState
): Promise<void> {
  if (state.branchDropdownOpen) return;

  const basePath = projectPath.value;
  if (!basePath || term.taskId == null) return;

  const targetEl = panel.querySelector('.ship-it-merge-target');
  if (!targetEl) return;

  state.branchDropdownOpen = true;
  targetEl.classList.add('open');

  // Fetch branches if not already loaded
  if (state.availableBranches.length === 0) {
    state.availableBranches = await window.api.worktree.listBranches(basePath);
  }

  // Filter out the current worktree branch and sort main branch to top
  const filteredBranches = state.availableBranches
    .filter(b => b.name !== term.worktreeBranch)
    .sort((a, b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      return 0;
    });

  // Build dropdown HTML
  const dropdownHtml = `
    <div class="ship-it-branch-dropdown">
      ${filteredBranches.map(branch => `
        <div class="ship-it-branch-dropdown-item${branch.name === state.mergeTarget ? ' selected' : ''}" data-branch="${escapeHtml(branch.name)}">
          <span class="ship-it-branch-name">${escapeHtml(branch.name)}</span>
          ${branch.isMain ? '<span class="ship-it-branch-main-badge">main</span>' : ''}
        </div>
      `).join('')}
    </div>
  `;

  targetEl.insertAdjacentHTML('beforeend', dropdownHtml);

  const dropdown = targetEl.querySelector('.ship-it-branch-dropdown');
  if (!dropdown) return;

  // Animate in
  requestAnimationFrame(() => {
    dropdown.classList.add('visible');
  });

  // Wire up item clicks
  dropdown.querySelectorAll('.ship-it-branch-dropdown-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const branchName = (item as HTMLElement).dataset.branch;
      if (branchName && branchName !== state.mergeTarget) {
        await selectMergeTarget(term, panel, branchName, state);
      } else {
        hideMergeTargetDropdown(panel, state);
      }
    });
  });

  // Click-outside handler
  const handleClickOutside = (e: MouseEvent) => {
    if (!targetEl.contains(e.target as Node)) {
      hideMergeTargetDropdown(panel, state);
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
    state.branchDropdownCleanup = () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, 0);
}

/**
 * Hide merge target dropdown
 */
function hideMergeTargetDropdown(
  panel: HTMLElement,
  state: ShipItPanelState
): void {
  if (!state.branchDropdownOpen) return;

  state.branchDropdownOpen = false;

  const targetEl = panel.querySelector('.ship-it-merge-target');
  const dropdown = targetEl?.querySelector('.ship-it-branch-dropdown');

  targetEl?.classList.remove('open');

  if (dropdown) {
    dropdown.classList.remove('visible');
    setTimeout(() => dropdown.remove(), 150);
  }

  state.branchDropdownCleanup?.();
  state.branchDropdownCleanup = null;
}

/**
 * Select a new merge target and refresh the diff
 */
async function selectMergeTarget(
  term: TheatreTerminal,
  panel: HTMLElement,
  branchName: string,
  state: ShipItPanelState
): Promise<void> {
  const basePath = projectPath.value;
  if (!basePath || term.taskId == null) return;

  // Close dropdown
  hideMergeTargetDropdown(panel, state);

  // Update state
  state.mergeTarget = branchName;

  // Persist the change
  await window.api.task.setMergeTarget(basePath, term.taskId, branchName);

  // Update the merge target display text
  const targetEl = panel.querySelector('.ship-it-merge-target');
  if (targetEl) {
    // Preserve the chevron icon when updating text
    const chevronHtml = '<i data-lucide="chevron-down"></i>';
    targetEl.innerHTML = `${escapeHtml(branchName)}${chevronHtml}`;
  }

  // Update ship button text
  const shipBtn = term.container.querySelector('.theatre-card-ship-btn') as HTMLElement;
  if (shipBtn && shipBtn.dataset.canShip === 'true') {
    shipBtn.innerHTML = `<i data-lucide="rocket"></i><span>Merge to ${escapeHtml(branchName)}</span>`;
  }

  // Re-initialize lucide icons
  const { createIcons, icons } = await import('lucide');
  createIcons({ icons, nameAttr: 'data-lucide' });

  // Refresh the diff with new target
  if (!state.showingUncommitted) {
    const diffSummary = await window.api.worktree.getDiff(basePath, term.worktreeBranch, branchName);
    const files = diffSummary?.files || [];
    state.files = files;

    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    // Update summary stats
    const summaryValueEls = panel.querySelectorAll('.ship-it-summary-value');
    if (summaryValueEls.length >= 3) {
      summaryValueEls[0].textContent = String(files.length);
      summaryValueEls[1].textContent = `+${totalAdditions}`;
      summaryValueEls[2].textContent = `-${totalDeletions}`;
    }

    // Update summary label
    const summaryLabelEl = panel.querySelector('.ship-it-summary-stat .ship-it-summary-label');
    if (summaryLabelEl) {
      summaryLabelEl.textContent = `file${files.length !== 1 ? 's' : ''} changed`;
    }

    // Update file list
    const fileListHtml = files.map(file => {
      const statusLabel = file.status === '?' ? 'U' : file.status;
      const stats = formatDiffStats(file.additions, file.deletions);
      return `
        <div class="ship-it-file${file.path === state.selectedFile ? ' ship-it-file--selected' : ''}" data-path="${escapeHtml(file.path)}" data-status="${file.status}" data-additions="${file.additions}" data-deletions="${file.deletions}">
          <span class="diff-file-status diff-file-status--${statusLabel}">${statusLabel}</span>
          <span class="ship-it-file-name" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
          <span class="ship-it-file-stats">${stats}</span>
        </div>
      `;
    }).join('');

    const fileList = panel.querySelector('.ship-it-file-list');
    if (fileList) {
      fileList.innerHTML = fileListHtml;

      // Re-wire file list clicks
      fileList.querySelectorAll('.ship-it-file').forEach(fileEl => {
        fileEl.addEventListener('click', () => {
          const path = (fileEl as HTMLElement).dataset.path;
          if (path) {
            selectShipItFile(term, panel, path, state);
          }
        });
      });
    }

    // Refresh the selected file diff if one was selected
    if (state.selectedFile && files.some(f => f.path === state.selectedFile)) {
      await selectShipItFile(term, panel, state.selectedFile, state);
    } else if (files.length > 0) {
      await selectShipItFile(term, panel, files[0].path, state);
    } else {
      const diffContent = panel.querySelector('.ship-it-diff-content');
      if (diffContent) {
        diffContent.innerHTML = '<div class="diff-empty-state">No changes compared to target branch</div>';
      }
    }
  }
}

/**
 * Generate default commit message from branch name
 */
function getDefaultCommitMessage(branchName: string): string {
  // Remove timestamp suffix (e.g., -1234567890) and replace dashes with spaces
  return branchName.replace(/-\d{10,}$/, '').replace(/-/g, ' ');
}

/**
 * Build the commit message dialog HTML
 */
function buildCommitDialogHtml(defaultMessage: string): string {
  return `
    <div class="ship-it-commit-dialog">
      <div class="ship-it-commit-dialog-content">
        <div class="ship-it-commit-dialog-header">Commit Message</div>
        <textarea class="ship-it-commit-message" rows="4" placeholder="Enter commit message...">${escapeHtml(defaultMessage)}</textarea>
        <div class="ship-it-commit-dialog-actions">
          <button class="ship-it-commit-cancel">Cancel</button>
          <button class="ship-it-commit-confirm">Merge</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Show commit message dialog before shipping
 */
function showCommitDialog(term: TheatreTerminal, panel: HTMLElement): void {
  if (!term.worktreeBranch || term.taskId == null) return;

  // Don't open multiple dialogs
  if (panel.querySelector('.ship-it-commit-dialog')) return;

  const defaultMessage = getDefaultCommitMessage(term.worktreeBranch);
  const dialogHtml = buildCommitDialogHtml(defaultMessage);
  panel.insertAdjacentHTML('beforeend', dialogHtml);

  const dialog = panel.querySelector('.ship-it-commit-dialog') as HTMLElement;
  const textarea = dialog?.querySelector('.ship-it-commit-message') as HTMLTextAreaElement;
  const cancelBtn = dialog?.querySelector('.ship-it-commit-cancel');
  const confirmBtn = dialog?.querySelector('.ship-it-commit-confirm');

  if (!dialog || !textarea) return;

  // Focus textarea and select all
  requestAnimationFrame(() => {
    dialog.classList.add('ship-it-commit-dialog--visible');
    textarea.focus();
    textarea.select();
  });

  const closeDialog = () => {
    unregisterHotkey('escape', Scopes.MODAL);
    unregisterHotkey(platformHotkey('mod+enter'), Scopes.MODAL);
    popScope();
    dialog.classList.remove('ship-it-commit-dialog--visible');
    setTimeout(() => dialog.remove(), 150);
  };

  cancelBtn?.addEventListener('click', closeDialog);

  // Close on mousedown outside the content
  dialog.addEventListener('mousedown', (e) => {
    if (e.target === dialog) closeDialog();
  });

  confirmBtn?.addEventListener('click', async () => {
    const message = textarea.value.trim();
    if (!message) {
      textarea.focus();
      return;
    }
    closeDialog();
    await executeShip(term, panel, message);
  });

  // Set up modal scope to prevent theatre hotkeys (like Escape) from firing
  pushScope(Scopes.MODAL);
  registerHotkey('escape', Scopes.MODAL, closeDialog);
  registerHotkey(platformHotkey('mod+enter'), Scopes.MODAL, async () => {
    const message = textarea.value.trim();
    if (message) {
      closeDialog();
      await executeShip(term, panel, message);
    }
  });
}

/**
 * Execute the ship operation (merge branch into main)
 */
async function executeShip(term: TheatreTerminal, panel: HTMLElement, commitMessage: string): Promise<void> {
  if (!term.worktreeBranch || term.taskId == null) return;

  const basePath = projectPath.value;
  if (!basePath) return;

  // Update ship button to show loading state
  const shipBtn = term.container.querySelector('.theatre-card-ship-btn') as HTMLElement;
  if (shipBtn) {
    shipBtn.dataset.canShip = 'false';
    shipBtn.innerHTML = '<span class="ship-it-loading"></span><span>Merging...</span>';
  }

  try {
    const result: ShipItResult = await window.api.worktree.ship(basePath, term.worktreeBranch, commitMessage);

    if (result.success) {
      showToast(`Merged: ${result.mergedBranch || term.worktreeBranch}`, 'success');

      // Close the panel
      hideShipItPanel(term);

      // Close the task and terminal
      const closeResult = await window.api.task.setStatus(basePath, term.taskId!, 'done');
      if (closeResult.success) {
        // Find terminal index and close it
        const idx = terminals.value.indexOf(term);
        if (idx !== -1) {
          theatreRegistry.closeTheatreTerminal?.(idx);
        }
        invalidateTaskList();
      }
    } else {
      // Handle error
      let errorMsg = result.error || 'Merge failed';

      if (result.conflictFiles && result.conflictFiles.length > 0) {
        errorMsg = `Merge conflict in: ${result.conflictFiles.slice(0, 3).join(', ')}`;
        if (result.conflictFiles.length > 3) {
          errorMsg += ` and ${result.conflictFiles.length - 3} more`;
        }
      }

      showToast(errorMsg, 'error');

      // Restore ship button
      if (shipBtn) {
        shipBtn.dataset.canShip = 'true';
        shipBtn.innerHTML = '<i data-lucide="rocket"></i><span>Merge to main</span>';
      }
    }
  } catch (error) {
    showToast(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');

    // Restore ship button
    if (shipBtn) {
      shipBtn.dataset.canShip = 'true';
      shipBtn.innerHTML = '<i data-lucide="rocket"></i><span>Merge to main</span>';
    }
  }
}

/**
 * Hide the Ship-It panel for a terminal
 */
export function hideShipItPanel(term: TheatreTerminal): void {
  const panel = term.container.querySelector('.ship-it-panel');
  if (!panel) return;

  // Restore ship button to collapsed state
  const shipBtn = term.container.querySelector('.theatre-card-ship-btn') as HTMLElement;
  if (shipBtn) {
    shipBtn.classList.remove('theatre-card-ship-btn--expanded', 'theatre-card-ship-btn--disabled');
    delete shipBtn.dataset.canShip;
    shipBtn.innerHTML = '<i data-lucide="rocket"></i>';
  }

  // Animate out
  panel.classList.remove('ship-it-panel--visible');

  // Remove after animation
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
  }, 200);
}

/**
 * Toggle Ship-It panel for active terminal (hotkey handler)
 */
export async function toggleActiveShipItPanel(): Promise<void> {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length === 0 || currentActiveIndex >= currentTerminals.length) {
    return;
  }

  const activeTerm = currentTerminals[currentActiveIndex];

  // Check if panel is already open
  const existingPanel = activeTerm.container.querySelector('.ship-it-panel');
  if (existingPanel) {
    hideShipItPanel(activeTerm);
  } else {
    await showShipItPanel(activeTerm);
  }
}

// Register in theatre registry for cross-module access
theatreRegistry.showShipItPanel = showShipItPanel;
theatreRegistry.hideShipItPanel = hideShipItPanel;
theatreRegistry.toggleActiveShipItPanel = toggleActiveShipItPanel;
