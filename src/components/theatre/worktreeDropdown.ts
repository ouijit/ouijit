/**
 * Worktree dropdown for theatre mode - agent shell creation and worktree management
 */

import { createIcons, GitBranchPlus, Terminal, Trash2 } from 'lucide';
import type { WorktreeInfo } from '../../types';
import { theatreState, MAX_THEATRE_TERMINALS } from './state';
import { projectPath, terminals, worktreeDropdownVisible } from './signals';
import { showToast } from '../importDialog';
import { addTheatreTerminal } from './terminalCards';

const worktreeIcons = { GitBranchPlus, Terminal, Trash2 };

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
      const wtOption = document.createElement('button');
      wtOption.className = 'launch-option launch-option--worktree';
      wtOption.title = 'Open terminal';

      const wtName = document.createElement('span');
      wtName.className = 'launch-option-name';
      wtName.textContent = wt.branch;
      wtOption.appendChild(wtName);

      // Click row to open terminal
      wtOption.addEventListener('click', async (e) => {
        e.stopPropagation();
        hideWorktreeDropdown();
        await addTheatreTerminal(undefined, { existingWorktree: wt });
      });

      const wtActions = document.createElement('div');
      wtActions.className = 'launch-option-actions';

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
