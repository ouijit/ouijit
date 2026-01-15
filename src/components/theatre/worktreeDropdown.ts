/**
 * Worktree dropdown for theatre mode - agent shell creation and worktree management
 */

import { createIcons, GitBranchPlus, Terminal, Trash2, Play, GitCompare, GitMerge } from 'lucide';
import type { WorktreeInfo, RunConfig } from '../../types';
import { theatreState, MAX_THEATRE_TERMINALS } from './state';
import { projectPath, projectData, terminals, worktreeDropdownVisible } from './signals';
import { showToast } from '../importDialog';
import { addTheatreTerminal } from './terminalCards';
import { showWorktreeDiffPanel } from './diffPanel';
import { refreshGitStatus } from './gitStatus';
import { mergeRunConfigs, getConfigId } from '../../utils/runConfigs';

const worktreeIcons = { GitBranchPlus, Terminal, Trash2, Play, GitCompare, GitMerge };

/**
 * Build the worktree dropdown content
 */
export async function buildWorktreeDropdownContent(dropdown: HTMLElement): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  dropdown.innerHTML = '';

  // New Agent Shell option (creates new worktree)
  const agentOption = document.createElement('button');
  agentOption.className = 'launch-option';
  const agentText = document.createElement('span');
  agentText.className = 'launch-option-name';
  agentText.textContent = 'New Agent Shell';
  agentOption.appendChild(agentText);
  const agentDesc = document.createElement('span');
  agentDesc.className = 'launch-option-source';
  agentDesc.textContent = 'isolated worktree';
  agentOption.appendChild(agentDesc);
  agentOption.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideWorktreeDropdown();
    await addTheatreTerminal(undefined, { useWorktree: true });
  });
  dropdown.appendChild(agentOption);

  // List existing worktrees
  const worktrees = await window.api.worktree.list(path);
  if (worktrees.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'launch-dropdown-divider';
    dropdown.appendChild(divider);

    const worktreeLabel = document.createElement('div');
    worktreeLabel.className = 'launch-dropdown-section-label';
    worktreeLabel.textContent = 'Existing Worktrees';
    dropdown.appendChild(worktreeLabel);

    for (const wt of worktrees) {
      const wtOption = document.createElement('div');
      wtOption.className = 'launch-option launch-option--worktree';

      const wtName = document.createElement('span');
      wtName.className = 'launch-option-name';
      wtName.textContent = wt.branch;
      wtOption.appendChild(wtName);

      const wtActions = document.createElement('div');
      wtActions.className = 'launch-option-actions';

      // Play button (run default command)
      const playBtn = document.createElement('button');
      playBtn.className = 'launch-option-action';
      playBtn.title = 'Run default command';
      playBtn.innerHTML = '<i data-lucide="play"></i>';
      playBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        hideWorktreeDropdown();
        await runDefaultInWorktree(wt);
      });
      wtActions.appendChild(playBtn);

      // Diff button
      const diffBtn = document.createElement('button');
      diffBtn.className = 'launch-option-action';
      diffBtn.title = 'View diff vs main';
      diffBtn.innerHTML = '<i data-lucide="git-compare"></i>';
      diffBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        hideWorktreeDropdown();
        await showWorktreeDiffPanel(wt.branch);
      });
      wtActions.appendChild(diffBtn);

      // Merge button
      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'launch-option-action';
      mergeBtn.title = 'Merge into main';
      mergeBtn.innerHTML = '<i data-lucide="git-merge"></i>';
      mergeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await mergeWorktree(wt, dropdown);
      });
      wtActions.appendChild(mergeBtn);

      // Open terminal button
      const openBtn = document.createElement('button');
      openBtn.className = 'launch-option-action';
      openBtn.title = 'Open terminal';
      openBtn.innerHTML = '<i data-lucide="terminal"></i>';
      openBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        hideWorktreeDropdown();
        await addTheatreTerminal(undefined, { existingWorktree: wt });
      });
      wtActions.appendChild(openBtn);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'launch-option-action launch-option-action--danger';
      removeBtn.title = 'Remove worktree';
      removeBtn.innerHTML = '<i data-lucide="trash-2"></i>';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = confirm(`Remove worktree "${wt.branch}"? This will delete the branch.`);
        if (confirmed && path) {
          const result = await window.api.worktree.remove(path, wt.path);
          if (result.success) {
            showToast('Worktree removed', 'success');
            await buildWorktreeDropdownContent(dropdown); // Refresh list
          } else {
            showToast(result.error || 'Failed to remove', 'error');
          }
        }
      });
      wtActions.appendChild(removeBtn);

      wtOption.appendChild(wtActions);
      dropdown.appendChild(wtOption);
    }
  }

  // Initialize icons
  createIcons({ icons: worktreeIcons, nodes: [dropdown] });
}

/**
 * Show the worktree dropdown
 */
export async function showWorktreeDropdown(): Promise<void> {
  if (worktreeDropdownVisible.value) return;

  const wrapper = document.querySelector('.theatre-worktree-wrapper');
  if (!wrapper) return;

  // Check if at max terminals
  if (terminals.value.length >= MAX_THEATRE_TERMINALS) {
    showToast(`Maximum ${MAX_THEATRE_TERMINALS} terminals`, 'info');
    return;
  }

  // Create dropdown if it doesn't exist
  let dropdown = wrapper.querySelector('.theatre-worktree-dropdown') as HTMLElement;
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'theatre-worktree-dropdown';
    wrapper.appendChild(dropdown);
  }

  await buildWorktreeDropdownContent(dropdown);

  requestAnimationFrame(() => {
    dropdown.classList.add('visible');
  });

  worktreeDropdownVisible.value = true;

  // Click outside handler
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.theatre-worktree-wrapper')) {
      hideWorktreeDropdown();
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 0);

  theatreState.worktreeDropdownCleanup = () => {
    document.removeEventListener('click', handleClickOutside);
  };
}

/**
 * Hide the worktree dropdown
 */
export function hideWorktreeDropdown(): void {
  if (!worktreeDropdownVisible.value) return;

  const dropdown = document.querySelector('.theatre-worktree-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
    setTimeout(() => dropdown.remove(), 150);
  }

  if (theatreState.worktreeDropdownCleanup) {
    theatreState.worktreeDropdownCleanup();
    theatreState.worktreeDropdownCleanup = null;
  }

  worktreeDropdownVisible.value = false;
}

/**
 * Toggle worktree dropdown visibility
 */
export function toggleWorktreeDropdown(): void {
  if (worktreeDropdownVisible.value) {
    hideWorktreeDropdown();
  } else {
    showWorktreeDropdown();
  }
}

/**
 * Run the default command in a worktree
 */
async function runDefaultInWorktree(wt: WorktreeInfo): Promise<void> {
  const path = projectPath.value;
  const project = projectData.value;
  if (!path || !project) return;

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

  await addTheatreTerminal(defaultConfig, { existingWorktree: wt });
}

/**
 * Merge a worktree branch into main
 */
async function mergeWorktree(wt: WorktreeInfo, dropdown: HTMLElement): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  const confirmed = confirm(`Merge "${wt.branch}" into main?`);
  if (!confirmed) return;

  const result = await window.api.worktree.merge(path, wt.branch);
  if (result.success) {
    showToast(`Merged ${wt.branch} into main`, 'success');
    await refreshGitStatus();
    await buildWorktreeDropdownContent(dropdown); // Refresh list
  } else {
    showToast(result.error || 'Merge failed', 'error');
  }
}
