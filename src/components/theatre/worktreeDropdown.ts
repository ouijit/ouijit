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

/**
 * Show a simple prompt dialog for naming a worktree
 */
function showWorktreeNamePrompt(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.style.maxWidth = '340px';

    dialog.innerHTML = `
      <h2 class="import-dialog-title">New Agent Shell</h2>
      <div class="new-project-form">
        <div class="form-group">
          <label class="form-label" for="worktree-name">Task name</label>
          <input
            type="text"
            id="worktree-name"
            class="form-input"
            placeholder="e.g., fix login bug"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>
      <div class="import-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="create">Create</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const nameInput = dialog.querySelector('#worktree-name') as HTMLInputElement;
    const createBtn = dialog.querySelector('[data-action="create"]') as HTMLButtonElement;

    const cleanup = () => {
      dialog.classList.remove('import-dialog--visible');
      overlay.classList.remove('modal-overlay--visible');
      setTimeout(() => overlay.remove(), 150);
    };

    const handleCreate = () => {
      cleanup();
      resolve(nameInput.value.trim() || null);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    // Event listeners
    createBtn.addEventListener('click', handleCreate);
    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) handleCancel();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCreate();
      if (e.key === 'Escape') handleCancel();
    });

    // Animate in and focus
    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('import-dialog--visible');
      nameInput.focus();
    });
  });
}

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
    const name = await showWorktreeNamePrompt();
    if (name !== null) {
      await addTheatreTerminal(undefined, { useWorktree: true, worktreeName: name || undefined });
    }
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
      wtName.textContent = formatBranchNameForDisplay(wt.branch);
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
