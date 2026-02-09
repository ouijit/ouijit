/**
 * Worktree/task operations for theatre mode
 */

import type { WorktreeWithMetadata } from '../../types';
import { MAX_THEATRE_TERMINALS } from './state';
import { projectPath, terminals, invalidateTaskList } from './signals';
import { showToast } from '../importDialog';
import { theatreRegistry } from './helpers';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes } from '../../utils/hotkeys';

/**
 * Result from the worktree name prompt dialog
 */
interface WorktreePromptResult {
  name: string | null;
  prompt: string | null;
  sandboxed: boolean | undefined;
}

/**
 * Show a simple prompt dialog for naming a worktree
 * Returns the task name and optional prompt, or null if cancelled
 */
async function showWorktreeNamePrompt(): Promise<WorktreePromptResult | null> {
  // Check lima availability
  const currentProjectPath = projectPath.value;
  let limaAvailable = false;
  if (currentProjectPath) {
    try {
      const limaStatus = await window.api.lima.status(currentProjectPath);
      limaAvailable = limaStatus.available;
    } catch {
      // Lima not available
    }
  }

  let sandboxState = false;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog new-task-dialog';

    dialog.innerHTML = `
      <form class="new-task-composer">
        <input
          type="text"
          id="worktree-name"
          class="new-task-composer-name"
          placeholder="Task name"
          autocomplete="off"
          spellcheck="false"
        />
        <textarea
          id="worktree-prompt"
          class="new-task-composer-prompt"
          placeholder="Describe what needs to be done..."
          spellcheck="false"
          rows="2"
        ></textarea>
        ${limaAvailable ? `
        <div class="new-task-composer-footer">
          <div class="new-task-sandbox-toggle">
            <div class="sandbox-toggle">
              <div class="sandbox-toggle-knob"></div>
            </div>
            <span class="new-task-sandbox-label">Sandbox</span>
          </div>
        </div>
        ` : ''}
        <button type="submit" class="new-task-composer-btn" aria-label="Create task">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </form>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const form = dialog.querySelector('.new-task-composer') as HTMLFormElement;
    const nameInput = dialog.querySelector('#worktree-name') as HTMLInputElement;
    const promptInput = dialog.querySelector('#worktree-prompt') as HTMLTextAreaElement;

    // Wire up sandbox toggle if present
    const sandboxToggleRow = dialog.querySelector('.new-task-sandbox-toggle');
    if (sandboxToggleRow) {
      sandboxToggleRow.addEventListener('click', () => {
        sandboxState = !sandboxState;
        const toggle = sandboxToggleRow.querySelector('.sandbox-toggle');
        if (toggle) {
          toggle.classList.toggle('sandbox-toggle--active', sandboxState);
        }
      });
    }

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      popScope();
      dialog.classList.remove('import-dialog--visible');
      overlay.classList.remove('modal-overlay--visible');
      setTimeout(() => overlay.remove(), 150);
    };

    const handleCreate = () => {
      const name = nameInput.value.trim() || null;
      const prompt = promptInput.value.trim() || null;
      cleanup();
      resolve({ name, prompt, sandboxed: limaAvailable ? sandboxState : undefined });
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    // Enter in name field focuses description instead of submitting
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        promptInput.focus();
      }
    });

    // Mod+Enter in prompt field submits the form
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    // Form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleCreate();
    });

    // Click outside to cancel
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) handleCancel();
    });

    // Set up hotkey scope for modal
    pushScope(Scopes.MODAL);
    registerHotkey('escape', Scopes.MODAL, handleCancel);

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
      sandboxed: result.sandboxed,
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
    invalidateTaskList();
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
    invalidateTaskList();
    // Open terminal for the task (without sandbox by default)
    await theatreRegistry.addTheatreTerminal?.(undefined, {
      existingWorktree: {
        path: task.path,
        branch: task.branch,
        taskName: task.name,
        createdAt: task.createdAt,
        readyToShip: task.readyToShip,
        prompt: task.prompt,
        sandboxed: task.sandboxed,
      },
      sandboxed: false,
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
    invalidateTaskList();
    showToast('Task deleted', 'success');
  } else {
    showToast(result.error || 'Failed to delete task', 'error');
  }
}

// Register functions in the theatre registry for cross-module access
theatreRegistry.createNewAgentShell = createNewAgentShell;
