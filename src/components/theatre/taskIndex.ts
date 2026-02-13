/**
 * Task index sidecar panel - browse and manage all tasks (open and closed)
 */

import type { TaskWithWorkspace } from '../../types';
import { theatreState } from './state';
import { projectPath, taskIndexVisible, terminals, invalidateTaskList } from './signals';
import { showToast } from '../importDialog';
import { theatreRegistry, showTaskContextMenu } from './helpers';
import { reopenTask, deleteTask, closeTask } from './worktreeDropdown';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes, platformHotkey } from '../../utils/hotkeys';

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
 * Build the task index panel HTML shell
 */
function buildTaskIndexHtml(): string {
  return `
    <div class="task-index-panel">
      <div class="task-index-header">
        <h2 class="task-index-title">Tasks</h2>
        <button class="task-index-close" title="Close"><i data-lucide="arrow-left"></i></button>
      </div>
      <div class="task-index-content">
        <div class="task-index-list task-index-list--open"></div>
        <div class="task-index-empty" style="display: none;">
          No tasks yet
        </div>
        <details class="task-index-closed-disclosure" style="display: none;">
          <summary class="task-index-closed-summary"></summary>
          <div class="task-index-list task-index-list--closed"></div>
        </details>
      </div>
    </div>
  `;
}

/**
 * Build a task item element
 */
function buildTaskItem(task: TaskWithWorkspace, path: string, index?: number, limaAvailable?: boolean): HTMLElement {
  const item = document.createElement('button');
  item.className = 'task-index-item';
  if (task.status === 'done') {
    item.classList.add('task-index-item--closed');
  }

  // Show modifier+N shortcut for first 9 items (⌘ on Mac, Ctrl on Linux/Windows)
  if (index !== undefined && index < 9) {
    const shortcut = document.createElement('kbd');
    shortcut.className = 'task-index-item-shortcut';
    const isMac = navigator.platform.toLowerCase().includes('mac');
    shortcut.innerHTML = isMac
      ? `⌘<span class="shortcut-number">${index + 1}</span>`
      : `Ctrl+<span class="shortcut-number">${index + 1}</span>`;
    item.appendChild(shortcut);
  }

  const nameSpan = document.createElement('span');
  nameSpan.className = 'task-index-item-name';
  nameSpan.textContent = task.name;
  item.appendChild(nameSpan);

  const actions = document.createElement('div');
  actions.className = 'task-index-item-actions';

  if (task.status === 'done') {
    // Reopen button
    const reopenBtn = document.createElement('button');
    reopenBtn.className = 'task-index-item-action';
    reopenBtn.title = 'Reopen task';
    reopenBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
    reopenBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideTaskIndex();
      await reopenTask(path, task);
    });
    actions.appendChild(reopenBtn);
  } else {
    // Close button (for open tasks)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'task-index-item-action task-index-item-action--close';
    closeBtn.title = 'Close task';
    closeBtn.innerHTML = '<i data-lucide="archive"></i>';
    closeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await closeTask(path, task);
    });
    actions.appendChild(closeBtn);
  }

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'task-index-item-action task-index-item-action--danger';
  deleteBtn.title = 'Delete task';
  deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteTask(path, task);
  });
  actions.appendChild(deleteBtn);

  item.appendChild(actions);

  const worktreeOpts = {
    path: task.worktreePath || '',
    branch: task.branch || '',
    createdAt: task.createdAt,
    sandboxed: task.sandboxed,
  };

  // Click handler - open/reopen task (always without sandbox)
  item.addEventListener('click', async () => {
    hideTaskIndex();

    if (task.status === 'done') {
      await reopenTask(path, task);
    } else {
      await theatreRegistry.addTheatreTerminal?.(undefined, {
        existingWorktree: worktreeOpts,
        taskId: task.taskNumber,
        sandboxed: false,
      });
    }
  });

  // Right-click: offer "Open in Sandbox" (only if lima available)
  if (limaAvailable) {
    item.addEventListener('contextmenu', (e) => {
      showTaskContextMenu(e, async () => {
        hideTaskIndex();
        if (task.status === 'done') {
          // Reopen and open sandboxed
          if (task.taskNumber != null) {
            const result = await window.api.task.setStatus(path, task.taskNumber, 'in_progress');
            if (result.success) {
              invalidateTaskList();
              await theatreRegistry.addTheatreTerminal?.(undefined, {
                existingWorktree: worktreeOpts,
                taskId: task.taskNumber,
                sandboxed: true,
              });
            }
          }
        } else {
          await theatreRegistry.addTheatreTerminal?.(undefined, {
            existingWorktree: worktreeOpts,
            taskId: task.taskNumber,
            sandboxed: true,
          });
        }
      });
    });
  }

  return item;
}

/**
 * Refresh the task index panel if it's visible
 */
export async function refreshTaskIndex(): Promise<void> {
  if (taskIndexVisible.value) {
    await populateTaskIndex();
  }
}

/**
 * Populate the task index panel with tasks
 */
async function populateTaskIndex(): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  const panel = document.querySelector('.task-index-panel');
  if (!panel) return;

  const openList = panel.querySelector('.task-index-list--open') as HTMLElement;
  const closedList = panel.querySelector('.task-index-list--closed') as HTMLElement;
  const emptyState = panel.querySelector('.task-index-empty') as HTMLElement;
  const closedDisclosure = panel.querySelector('.task-index-closed-disclosure') as HTMLDetailsElement;
  const closedSummary = panel.querySelector('.task-index-closed-summary') as HTMLElement;

  if (!openList || !closedList || !emptyState || !closedDisclosure || !closedSummary) return;

  // Fetch tasks and check lima availability
  const [tasks, limaAvailable] = await Promise.all([
    window.api.task.getAll(path),
    window.api.lima.status(path).then(s => s.available).catch(() => false),
  ]);
  const openTasks = tasks.filter(t => t.status !== 'done');
  const closedTasks = tasks.filter(t => t.status === 'done');

  // Clear lists
  openList.innerHTML = '';
  closedList.innerHTML = '';

  // Track index for keyboard shortcuts
  let itemIndex = 0;

  // Populate open tasks
  for (const task of openTasks) {
    const item = buildTaskItem(task, path, itemIndex++, limaAvailable);
    openList.appendChild(item);
  }

  // Populate closed tasks disclosure
  if (closedTasks.length > 0) {
    closedDisclosure.style.display = 'block';
    closedSummary.textContent = `${closedTasks.length} closed`;
    for (const task of closedTasks) {
      const item = buildTaskItem(task, path, itemIndex++, limaAvailable);
      closedList.appendChild(item);
    }
  } else {
    closedDisclosure.style.display = 'none';
  }

  // Show empty state only if no open tasks
  if (openTasks.length === 0 && closedTasks.length === 0) {
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
  }
}

/**
 * Show the task index panel
 */
export async function showTaskIndex(): Promise<void> {
  if (taskIndexVisible.value) return;

  // Set immediately to prevent re-entry during async operations
  taskIndexVisible.value = true;

  const mainContent = document.querySelector('.main-content');
  if (!mainContent) {
    taskIndexVisible.value = false;
    return;
  }

  // Create panel if it doesn't exist
  let panel = document.querySelector('.task-index-panel');
  if (!panel) {
    mainContent.insertAdjacentHTML('beforeend', buildTaskIndexHtml());
    panel = document.querySelector('.task-index-panel');
    if (!panel) {
      taskIndexVisible.value = false;
      return;
    }

    // Wire up close button
    const closeBtn = panel.querySelector('.task-index-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => hideTaskIndex());
    }
  }

  // Populate tasks
  await populateTaskIndex();

  // Add class to body for stack repositioning
  document.body.classList.add('task-index-open');

  // Animate panel in
  requestAnimationFrame(() => {
    panel!.classList.add('task-index-panel--visible');
  });

  // Push task index scope to capture hotkeys
  pushScope(Scopes.TASK_INDEX);

  // Register scoped hotkeys
  registerHotkey('escape', Scopes.TASK_INDEX, () => {
    hideTaskIndex();
  });

  registerHotkey(platformHotkey('mod+t'), Scopes.TASK_INDEX, () => {
    hideTaskIndex();
  });

  registerHotkey(platformHotkey('mod+n'), Scopes.TASK_INDEX, () => {
    hideTaskIndex();
    theatreRegistry.createNewAgentShell?.();
  });

  // Mod+1-9 for quick select
  for (let i = 1; i <= 9; i++) {
    registerHotkey(platformHotkey(`mod+${i}`), Scopes.TASK_INDEX, () => {
      const items = Array.from(panel!.querySelectorAll('.task-index-item')) as HTMLElement[];
      if (i - 1 < items.length) {
        items[i - 1].click();
      }
    });
  }

  theatreState.taskIndexCleanup = () => {
    unregisterHotkey('escape', Scopes.TASK_INDEX);
    unregisterHotkey(platformHotkey('mod+t'), Scopes.TASK_INDEX);
    unregisterHotkey(platformHotkey('mod+n'), Scopes.TASK_INDEX);
    for (let i = 1; i <= 9; i++) {
      unregisterHotkey(platformHotkey(`mod+${i}`), Scopes.TASK_INDEX);
    }
    popScope();
  };
}

/**
 * Hide the task index panel
 */
export function hideTaskIndex(): void {
  if (!taskIndexVisible.value) return;

  const panel = document.querySelector('.task-index-panel');
  if (panel) {
    panel.classList.remove('task-index-panel--visible');
  }

  // Remove class from body
  document.body.classList.remove('task-index-open');

  // Cleanup
  if (theatreState.taskIndexCleanup) {
    theatreState.taskIndexCleanup();
    theatreState.taskIndexCleanup = null;
  }

  taskIndexVisible.value = false;
}

/**
 * Toggle task index panel visibility
 */
export function toggleTaskIndex(): void {
  if (taskIndexVisible.value) {
    hideTaskIndex();
  } else {
    showTaskIndex();
  }
}

// Register functions in the theatre registry for cross-module access
theatreRegistry.toggleTaskIndex = toggleTaskIndex;
theatreRegistry.refreshTaskIndex = refreshTaskIndex;
