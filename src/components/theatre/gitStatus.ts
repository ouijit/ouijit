/**
 * Git status display and branch management for theatre mode
 */

import { createIcons, GitBranch, ChevronDown, Plus, GitMerge } from 'lucide';
import type { CompactGitStatus, GitDropdownInfo } from '../../types';
import { theatreState, GIT_STATUS_IDLE_DELAY } from './state';
import { projectPath, gitDropdownVisible } from './signals';
import { toggleDiffPanel } from './diffPanel';
import { showToast } from '../importDialog';

const gitIcons = { GitBranch, ChevronDown, Plus, GitMerge };

/**
 * Build git status HTML (pill with two click zones)
 */
export function buildGitStatusHtml(compactStatus: CompactGitStatus | null): string {
  if (!compactStatus) return '';

  const {
    branch,
    mainBranch,
    dirtyFileCount,
    insertions,
    deletions,
    branchDiffFileCount,
    branchDiffInsertions,
    branchDiffDeletions,
  } = compactStatus;

  // Determine what stats to show:
  // 1. If dirty (uncommitted changes): show uncommitted changes
  // 2. Else if on feature branch with branch diff: show branch vs main with "vs main" label
  const showUncommitted = dirtyFileCount > 0;
  const showBranchDiff = !showUncommitted && branch !== mainBranch && branchDiffFileCount > 0;

  let statsContent = '';
  let statsZoneClass = 'theatre-git-stats-zone';

  if (showUncommitted) {
    // Show uncommitted changes - clickable to open diff panel
    const maxDots = 5;
    const addDots = Math.min(Math.ceil(insertions / 10), maxDots);
    const delDots = Math.min(Math.ceil(deletions / 10), maxDots);
    let dotsHtml = '';
    if (addDots > 0 || delDots > 0) {
      dotsHtml = '<span class="theatre-git-dots">';
      for (let i = 0; i < addDots; i++) dotsHtml += '<span class="dot dot--add"></span>';
      for (let i = 0; i < delDots; i++) dotsHtml += '<span class="dot dot--del"></span>';
      dotsHtml += '</span>';
    }
    statsContent = `<span class="theatre-git-dirty">${dirtyFileCount}${dotsHtml}</span>`;
    statsZoneClass = 'theatre-git-stats-zone theatre-git-stats-zone--clickable';
  } else if (showBranchDiff) {
    // Show branch vs main comparison - not clickable
    const maxDots = 5;
    const addDots = Math.min(Math.ceil(branchDiffInsertions / 10), maxDots);
    const delDots = Math.min(Math.ceil(branchDiffDeletions / 10), maxDots);
    let dotsHtml = '';
    if (addDots > 0 || delDots > 0) {
      dotsHtml = '<span class="theatre-git-dots">';
      for (let i = 0; i < addDots; i++) dotsHtml += '<span class="dot dot--add"></span>';
      for (let i = 0; i < delDots; i++) dotsHtml += '<span class="dot dot--del"></span>';
      dotsHtml += '</span>';
    }
    statsContent = `<span class="theatre-git-dirty">${branchDiffFileCount}${dotsHtml}</span><span class="theatre-git-vs-main">vs ${mainBranch}</span>`;
  }

  const hasStats = showUncommitted || showBranchDiff;

  return `
    <div class="theatre-git-status">
      <div class="theatre-git-branch-zone" role="button" tabindex="0" title="Switch branch">
        <i data-lucide="git-branch" class="theatre-git-icon"></i>
        <span class="theatre-git-branch">${branch}</span>
        <i data-lucide="chevron-down" class="theatre-git-chevron"></i>
      </div>
      ${hasStats ? `<div class="${statsZoneClass}" role="button" tabindex="0" title="${showUncommitted ? 'View changes' : ''}">${statsContent}</div>` : ''}
    </div>
  `;
}

/**
 * Build git dropdown HTML (simplified - just branch list for switching)
 */
export function buildGitDropdownHtml(info: GitDropdownInfo): string {
  const { current, recentBranches, mainBranch } = info;

  // Build branch list (main branch first if not current, then recent)
  const branches: { name: string; isCurrent: boolean; stats: string }[] = [];

  // Add main branch if not current
  if (current.branch !== mainBranch) {
    branches.push({ name: mainBranch, isCurrent: false, stats: '' });
  }

  // Add recent branches
  for (const branch of recentBranches) {
    branches.push({
      name: branch.name,
      isCurrent: false,
      stats: branch.lastCommitAge,
    });
  }

  const branchItems = branches.map(branch => `
    <div class="git-dropdown-branch" data-branch="${branch.name}">
      <span class="git-dropdown-branch-name">${branch.name}</span>
      ${branch.stats ? `<span class="git-dropdown-branch-stats">${branch.stats}</span>` : ''}
    </div>
  `).join('');

  // New branch action (always shown)
  const newBranchAction = `
    <div class="git-dropdown-new-branch">
      <i data-lucide="plus" class="git-dropdown-new-icon"></i>
      <span>New branch</span>
    </div>
    <div class="git-dropdown-new-input" style="display: none;">
      <input type="text" placeholder="Branch name" spellcheck="false" autocomplete="off" />
    </div>
  `;

  return `
    <div class="theatre-git-dropdown">
      ${branchItems}
      ${branches.length > 0 ? '<div class="git-dropdown-separator"></div>' : ''}
      ${newBranchAction}
    </div>
  `;
}

/**
 * Switch to a branch using IPC git checkout
 */
export async function switchToBranch(branchName: string): Promise<void> {
  if (!projectPath.value) return;

  // Close dropdown immediately for responsiveness
  hideGitDropdown();

  const result = await window.api.gitCheckout(projectPath.value!, branchName);

  if (result.success) {
    showToast(`Switched to ${branchName}`, 'success');
    // Trigger git status refresh to update the UI
    await refreshGitStatus();
  } else {
    showToast(result.error || 'Checkout failed', 'error');
  }
}

/**
 * Create a new branch using IPC
 */
export async function createNewBranch(branchName: string): Promise<void> {
  if (!projectPath.value) return;

  // Close dropdown immediately for responsiveness
  hideGitDropdown();

  const result = await window.api.gitCreateBranch(projectPath.value, branchName);

  if (result.success) {
    showToast(`Created branch ${branchName}`, 'success');
    // Trigger git status refresh to update the UI
    await refreshGitStatus();
  } else {
    showToast(result.error || 'Failed to create branch', 'error');
  }
}

/**
 * Perform merge of current branch into main
 */
export async function performMergeIntoMain(): Promise<void> {
  if (!projectPath.value) return;

  const result = await window.api.gitMergeIntoMain(projectPath.value);

  if (result.success) {
    showToast(`Merged ${result.mergedBranch} into main`, 'success');
    // Refresh git status to update UI (will now be on main)
    await refreshGitStatus();
  } else {
    showToast(result.error || 'Merge failed', 'error');
  }
}

/**
 * Show the git dropdown
 */
export async function showGitDropdown(path: string): Promise<void> {
  if (gitDropdownVisible.value) return;

  const branchZone = document.querySelector('.theatre-git-branch-zone');
  if (!branchZone) return;

  // Remove any lingering dropdown elements (in case previous hide animation hasn't finished)
  const existingDropdown = branchZone.querySelector('.theatre-git-dropdown');
  if (existingDropdown) {
    existingDropdown.remove();
  }

  // Fetch dropdown info
  const info = await window.api.getGitDropdownInfo(path);
  if (!info) return;

  // Create and insert dropdown as a child of branch zone for proper positioning
  const dropdownHtml = buildGitDropdownHtml(info);
  branchZone.insertAdjacentHTML('beforeend', dropdownHtml);

  const dropdown = branchZone.querySelector('.theatre-git-dropdown');
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

  // Wire up new branch action
  const newBranchAction = dropdown.querySelector('.git-dropdown-new-branch');
  const newBranchInput = dropdown.querySelector('.git-dropdown-new-input');
  const inputEl = newBranchInput?.querySelector('input');

  if (newBranchAction && newBranchInput && inputEl) {
    newBranchAction.addEventListener('click', (e) => {
      e.stopPropagation();
      (newBranchAction as HTMLElement).style.display = 'none';
      (newBranchInput as HTMLElement).style.display = 'flex';
      inputEl.focus();
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const branchName = inputEl.value.trim();
        if (branchName) {
          createNewBranch(branchName);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Reset to show the action button
        (newBranchAction as HTMLElement).style.display = 'flex';
        (newBranchInput as HTMLElement).style.display = 'none';
        inputEl.value = '';
      }
    });

    // Prevent dropdown close when clicking in input
    inputEl.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // Initialize lucide icons for the dropdown
  window.lucide?.createIcons({ nodes: [dropdown as Element] });

  // Show with animation
  requestAnimationFrame(() => {
    dropdown.classList.add('visible');
  });

  gitDropdownVisible.value = true;

  // Set up click outside handler
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.theatre-git-branch-zone') && !target.closest('.theatre-git-dropdown')) {
      hideGitDropdown();
    }
  };

  // Use setTimeout to avoid immediately triggering from current click
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 0);

  theatreState.gitDropdownCleanup = () => {
    document.removeEventListener('click', handleClickOutside);
  };
}

/**
 * Hide the git dropdown
 */
export function hideGitDropdown(): void {
  if (!gitDropdownVisible.value) return;

  const branchZone = document.querySelector('.theatre-git-branch-zone');
  const dropdown = branchZone?.querySelector('.theatre-git-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
    // Remove after animation
    setTimeout(() => dropdown.remove(), 150);
  }

  if (theatreState.gitDropdownCleanup) {
    theatreState.gitDropdownCleanup();
    theatreState.gitDropdownCleanup = null;
  }

  gitDropdownVisible.value = false;
}

/**
 * Toggle git dropdown visibility
 */
export async function toggleGitDropdown(path: string): Promise<void> {
  if (gitDropdownVisible.value) {
    hideGitDropdown();
  } else {
    await showGitDropdown(path);
  }
}

/**
 * Update just the git status element in the theatre header
 */
export function updateGitStatusElement(compactStatus: CompactGitStatus | null): void {
  const headerContent = document.querySelector('.header-content');
  if (!headerContent) return;

  // Remove existing git status element
  const existingGitStatus = headerContent.querySelector('.theatre-git-status');
  if (existingGitStatus) {
    existingGitStatus.remove();
  }

  // Remove existing merge button
  const existingMergeBtn = headerContent.querySelector('.theatre-merge-btn');
  if (existingMergeBtn) {
    existingMergeBtn.remove();
  }

  // If no git status, we're done
  if (!compactStatus) return;

  // Insert new git status before the worktree wrapper
  const worktreeWrapper = headerContent.querySelector('.theatre-worktree-wrapper');
  if (worktreeWrapper) {
    const gitStatusHtml = buildGitStatusHtml(compactStatus);
    worktreeWrapper.insertAdjacentHTML('beforebegin', gitStatusHtml);

    // Check if merge button should be shown
    const canMerge = compactStatus.branch !== compactStatus.mainBranch &&
      compactStatus.commitsAheadOfMain > 0 &&
      compactStatus.dirtyFileCount === 0;

    if (canMerge) {
      const mergeButtonHtml = `<button class="theatre-merge-btn" title="Merge into ${compactStatus.mainBranch}">
        <i data-lucide="git-merge"></i>
        <span>Merge into ${compactStatus.mainBranch}</span>
      </button>`;
      worktreeWrapper.insertAdjacentHTML('beforebegin', mergeButtonHtml);

      // Wire up merge button
      const mergeBtn = headerContent.querySelector('.theatre-merge-btn');
      if (mergeBtn) {
        mergeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await performMergeIntoMain();
        });
      }
    }

    createIcons({ icons: gitIcons, nodes: [headerContent as HTMLElement] });

    // Wire up click handlers for the two zones
    const currentProjectPath = projectPath.value;
    if (currentProjectPath) {
      // Branch zone - opens branch dropdown
      const branchZone = headerContent.querySelector('.theatre-git-branch-zone');
      if (branchZone) {
        branchZone.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleGitDropdown(currentProjectPath);
        });
      }

      // Stats zone - toggles diff panel (only if dirty)
      const statsZone = headerContent.querySelector('.theatre-git-stats-zone--clickable');
      if (statsZone) {
        statsZone.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleDiffPanel();
        });
      }
    }
  }
}

/**
 * Refresh git status for the current theatre mode project
 */
export async function refreshGitStatus(): Promise<void> {
  if (!projectPath.value) return;

  const compactStatus = await window.api.getCompactGitStatus(projectPath.value);

  if (gitDropdownVisible.value) {
    // Only update the file count text while dropdown is open (avoid destroying dropdown)
    const dirtyEl = document.querySelector('.theatre-git-dirty');
    if (compactStatus && dirtyEl) {
      // Update dirty count while preserving dots structure
      const firstChild = dirtyEl.firstChild;
      if (firstChild?.nodeType === Node.TEXT_NODE) {
        const count = compactStatus.dirtyFileCount > 0
          ? compactStatus.dirtyFileCount
          : compactStatus.branchDiffFileCount;
        firstChild.textContent = count > 0 ? `${count}` : '';
      }
    }
  } else {
    updateGitStatusElement(compactStatus);
  }
}

/**
 * Schedule a git status refresh after idle period
 */
export function scheduleGitStatusRefresh(): void {
  // Clear any existing timeout
  if (theatreState.gitStatusIdleTimeout) {
    clearTimeout(theatreState.gitStatusIdleTimeout);
  }

  // Update last output time
  theatreState.lastTerminalOutputTime = Date.now();

  // Schedule refresh after idle period
  theatreState.gitStatusIdleTimeout = setTimeout(() => {
    refreshGitStatus();
  }, GIT_STATUS_IDLE_DELAY);
}
