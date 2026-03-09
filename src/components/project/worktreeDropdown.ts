/**
 * Worktree/task operations for project mode
 */

import type { TaskWithWorkspace } from '../../types';
import { projectPath, invalidateTaskList } from './signals';
import { getManager } from '../terminal';
import { showToast } from '../importDialog';
import { projectRegistry } from './helpers';
import { setCardLoading } from './kanbanBoard';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes } from '../../utils/hotkeys';
import log from 'electron-log/renderer';

const worktreeDropdownLog = log.scope('worktreeDropdown');

/**
 * Show a confirmation dialog for deleting a task
 */
function showDeleteConfirmDialog(taskName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '380px';

    dialog.innerHTML = `
      <h2 class="dialog-title">Delete Task?</h2>
      <p class="dialog-text">
        This will permanently remove the worktree and branch for "<strong>${taskName}</strong>".
      </p>
      <div class="dialog-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-danger" data-action="delete">Delete</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      popScope();
      dialog.classList.remove('dialog--visible');
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
      dialog.classList.add('dialog--visible');
    });
  });
}

/**
 * Show a dialog when a task's worktree directory is missing
 * Returns 'recover' if user wants to recreate, or null if cancelled
 */
export function showMissingWorktreeDialog(task: TaskWithWorkspace, branchExists: boolean): Promise<'recover' | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '420px';

    const branchHtml = task.branch
      ? `<p class="dialog-text" style="margin-top: 4px; font-size: 12px; opacity: 0.7;">Branch: <code>${task.branch}</code></p>`
      : '';

    dialog.innerHTML = `
      <h2 class="dialog-title">Worktree Not Found</h2>
      <p class="dialog-text">
        The worktree directory for "<strong>${task.name}</strong>" no longer exists on disk.
      </p>
      ${branchHtml}
      <div class="dialog-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        ${branchExists ? '<button class="btn btn-primary" data-action="recover">Recreate Worktree</button>' : ''}
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      popScope();
      dialog.classList.remove('dialog--visible');
      overlay.classList.remove('modal-overlay--visible');
      setTimeout(() => overlay.remove(), 150);
    };

    const handleRecover = () => {
      cleanup();
      resolve('recover');
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    dialog.querySelector('[data-action="recover"]')?.addEventListener('click', handleRecover);
    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) handleCancel();
    });

    pushScope(Scopes.MODAL);
    registerHotkey('escape', Scopes.MODAL, handleCancel);

    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('dialog--visible');
    });
  });
}

/**
 * Close a task - marks as closed and closes any open terminals for it
 */
export async function closeTask(path: string, task: TaskWithWorkspace): Promise<void> {
  if (task.taskNumber == null) return;
  setCardLoading(task.taskNumber, true);
  // Close any open terminals for this task
  const currentTerminals = getManager().terminals.value;
  for (let i = currentTerminals.length - 1; i >= 0; i--) {
    const term = currentTerminals[i];
    if (term.taskId === task.taskNumber) {
      projectRegistry.closeProjectTerminal?.(i);
    }
  }
  const result = await window.api.task.setStatus(path, task.taskNumber, 'done');
  if (result.success) {
    invalidateTaskList();
    showToast('Task closed', 'success');
  } else {
    showToast(result.error || 'Failed to close task', 'error');
  }
}

/**
 * Reopen a closed task
 */
export async function reopenTask(path: string, task: TaskWithWorkspace): Promise<void> {
  if (task.taskNumber == null) return;
  setCardLoading(task.taskNumber, true);
  worktreeDropdownLog.info('reopening task', { taskNumber: task.taskNumber, worktreePath: task.worktreePath || null });
  const result = await window.api.task.setStatus(path, task.taskNumber, 'in_progress');
  if (result.success) {
    invalidateTaskList();
    // Open terminal for the task (without sandbox by default)
    const taskPath = task.worktreePath || '';
    await projectRegistry.addProjectTerminal?.(undefined, {
      existingWorktree: {
        path: taskPath,
        branch: task.branch || '',
        createdAt: task.createdAt,
        prompt: task.prompt,
        sandboxed: task.sandboxed,
      },
      taskId: task.taskNumber,
      sandboxed: false,
    });
  } else {
    worktreeDropdownLog.error('reopen failed', { taskNumber: task.taskNumber, error: result.error });
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

  setCardLoading(task.taskNumber, true);

  // Close any open terminals for this task first
  const currentTerminals = getManager().terminals.value;
  for (let i = currentTerminals.length - 1; i >= 0; i--) {
    const term = currentTerminals[i];
    if (term.taskId === task.taskNumber) {
      projectRegistry.closeProjectTerminal?.(i);
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

