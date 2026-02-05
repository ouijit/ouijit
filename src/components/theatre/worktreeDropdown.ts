/**
 * Worktree/task operations for theatre mode
 */

import type { WorktreeWithMetadata } from '../../types';
import { MAX_THEATRE_TERMINALS } from './state';
import { projectPath, terminals } from './signals';
import { showToast } from '../importDialog';
import { theatreRegistry } from './helpers';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes } from '../../utils/hotkeys';

/**
 * Result from the worktree name prompt dialog
 */
interface WorktreePromptResult {
  name: string | null;
  prompt: string | null;
}

/**
 * Show a simple prompt dialog for naming a worktree
 * Returns the task name and optional prompt, or null if cancelled
 */
function showWorktreeNamePrompt(): Promise<WorktreePromptResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.style.maxWidth = '400px';

    dialog.innerHTML = `
      <h2 class="import-dialog-title">New Task</h2>
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
        <div class="form-group" style="margin-top: 16px;">
          <label class="form-label" for="worktree-prompt">Description <span class="form-label-optional">(optional)</span></label>
          <textarea
            id="worktree-prompt"
            class="form-input"
            style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; resize: vertical; padding-top: 10px; min-height: 60px;"
            placeholder="What needs to be done..."
            autocomplete="off"
            spellcheck="false"
            rows="2"
          ></textarea>
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
    const promptInput = dialog.querySelector('#worktree-prompt') as HTMLTextAreaElement;
    const createBtn = dialog.querySelector('[data-action="create"]') as HTMLButtonElement;

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      unregisterHotkey('enter', Scopes.MODAL);
      popScope();
      dialog.classList.remove('import-dialog--visible');
      overlay.classList.remove('modal-overlay--visible');
      setTimeout(() => overlay.remove(), 150);
    };

    const handleCreate = () => {
      const name = nameInput.value.trim() || null;
      const prompt = promptInput.value.trim() || null;
      cleanup();
      resolve({ name, prompt });
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    // Event listeners
    createBtn.addEventListener('click', handleCreate);
    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) handleCancel();
    });

    // Set up hotkey scope for modal
    pushScope(Scopes.MODAL);
    registerHotkey('escape', Scopes.MODAL, handleCancel);
    registerHotkey('enter', Scopes.MODAL, handleCreate);

    // Animate in and focus
    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('import-dialog--visible');
      nameInput.focus();
    });
  });
}

/**
 * Show a confirmation dialog for deleting a task
 */
function showDeleteConfirmDialog(taskName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.style.maxWidth = '380px';

    dialog.innerHTML = `
      <h2 class="import-dialog-title">Delete Task?</h2>
      <p class="import-dialog-text">
        This will permanently remove the worktree and branch for "<strong>${taskName}</strong>".
      </p>
      <div class="import-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-danger" data-action="delete">Delete</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      popScope();
      dialog.classList.remove('import-dialog--visible');
      overlay.classList.remove('modal-overlay--visible');
      setTimeout(() => overlay.remove(), 150);
    };

    const handleDelete = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // Event listeners
    dialog.querySelector('[data-action="delete"]')?.addEventListener('click', handleDelete);
    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) handleCancel();
    });

    // Set up hotkey scope for modal
    pushScope(Scopes.MODAL);
    registerHotkey('escape', Scopes.MODAL, handleCancel);

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('import-dialog--visible');
    });
  });
}

/**
 * Create a new agent shell (worktree) - can be called from keyboard shortcut
 */
export async function createNewAgentShell(): Promise<void> {
  // Check if at max terminals
  if (terminals.value.length >= MAX_THEATRE_TERMINALS) {
    showToast(`Maximum ${MAX_THEATRE_TERMINALS} terminals`, 'info');
    return;
  }

  const result = await showWorktreeNamePrompt();
  if (result !== null) {
    await theatreRegistry.addTheatreTerminal?.(undefined, {
      useWorktree: true,
      worktreeName: result.name || undefined,
      worktreePrompt: result.prompt || undefined,
    });
  }
}

/**
 * Close a task - marks as closed and closes any open terminals for it
 */
export async function closeTask(path: string, task: WorktreeWithMetadata): Promise<void> {
  const result = await window.api.worktree.close(path, task.branch);
  if (result.success) {
    // Close any open terminals for this task
    const currentTerminals = terminals.value;
    for (let i = currentTerminals.length - 1; i >= 0; i--) {
      const term = currentTerminals[i];
      if (term.worktreeBranch === task.branch) {
        theatreRegistry.closeTheatreTerminal?.(i);
      }
    }
    // Show warning if cleanup hook failed
    if (result.hookWarning) {
      showToast(`Task closed (cleanup hook failed)`, 'warning');
    } else {
      showToast('Task closed', 'success');
    }
  } else {
    showToast(result.error || 'Failed to close task', 'error');
  }
}

/**
 * Reopen a closed task
 */
export async function reopenTask(path: string, task: WorktreeWithMetadata): Promise<void> {
  const result = await window.api.worktree.reopen(path, task.branch);
  if (result.success) {
    // Open terminal for the task
    await theatreRegistry.addTheatreTerminal?.(undefined, {
      existingWorktree: {
        path: task.path,
        branch: task.branch,
        taskName: task.name,
        createdAt: task.createdAt,
        readyToShip: task.readyToShip,
        prompt: task.prompt,
      },
    });
  } else {
    showToast(result.error || 'Failed to reopen task', 'error');
  }
}

/**
 * Delete a task - hard delete with confirmation
 */
export async function deleteTask(path: string, task: WorktreeWithMetadata): Promise<void> {
  const confirmed = await showDeleteConfirmDialog(task.name);
  if (!confirmed) return;

  // Close any open terminals for this task first
  const currentTerminals = terminals.value;
  for (let i = currentTerminals.length - 1; i >= 0; i--) {
    const term = currentTerminals[i];
    if (term.worktreeBranch === task.branch) {
      theatreRegistry.closeTheatreTerminal?.(i);
    }
  }

  const result = await window.api.worktree.remove(path, task.path);
  if (result.success) {
    showToast('Task deleted', 'success');
  } else {
    showToast(result.error || 'Failed to delete task', 'error');
  }
}

// Register functions in the theatre registry for cross-module access
theatreRegistry.createNewAgentShell = createNewAgentShell;
