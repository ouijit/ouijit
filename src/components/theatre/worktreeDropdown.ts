/**
 * Worktree/task operations for theatre mode
 */

import type { TaskWithWorkspace } from '../../types';
import { projectPath, terminals, invalidateTaskList } from './signals';
import { showToast } from '../importDialog';
import { theatreRegistry } from './helpers';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes } from '../../utils/hotkeys';

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
 * Close a task - marks as closed and closes any open terminals for it
 */
export async function closeTask(path: string, task: TaskWithWorkspace): Promise<void> {
  if (task.taskNumber == null) return;
  const result = await window.api.task.setStatus(path, task.taskNumber, 'done');
  if (result.success) {
    // Close any open terminals for this task
    const currentTerminals = terminals.value;
    for (let i = currentTerminals.length - 1; i >= 0; i--) {
      const term = currentTerminals[i];
      if (term.taskId === task.taskNumber) {
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
export async function reopenTask(path: string, task: TaskWithWorkspace): Promise<void> {
  if (task.taskNumber == null) return;
  const result = await window.api.task.setStatus(path, task.taskNumber, 'in_progress');
  if (result.success) {
    invalidateTaskList();
    // Open terminal for the task (without sandbox by default)
    const taskPath = task.worktreePath || '';
    await theatreRegistry.addTheatreTerminal?.(undefined, {
      existingWorktree: {
        path: taskPath,
        branch: task.branch || '',
        taskName: task.name,
        createdAt: task.createdAt,
        prompt: task.prompt,
        sandboxed: task.sandboxed,
      },
      taskId: task.taskNumber,
      sandboxed: false,
    });
  } else {
    showToast(result.error || 'Failed to reopen task', 'error');
  }
}

/**
 * Delete a task - hard delete with confirmation
 */
export async function deleteTask(path: string, task: TaskWithWorkspace): Promise<void> {
  if (task.taskNumber == null) return;
  const confirmed = await showDeleteConfirmDialog(task.name);
  if (!confirmed) return;

  // Close any open terminals for this task first
  const currentTerminals = terminals.value;
  for (let i = currentTerminals.length - 1; i >= 0; i--) {
    const term = currentTerminals[i];
    if (term.taskId === task.taskNumber) {
      theatreRegistry.closeTheatreTerminal?.(i);
    }
  }

  const result = await window.api.task.delete(path, task.taskNumber);
  if (result.success) {
    invalidateTaskList();
    showToast('Task deleted', 'success');
  } else {
    showToast(result.error || 'Failed to delete task', 'error');
  }
}

