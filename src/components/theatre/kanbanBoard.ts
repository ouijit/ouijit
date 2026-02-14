/**
 * Kanban board view — spatial task management with drag-and-drop
 */

import type { TaskWithWorkspace, TaskStatus, RunConfig } from '../../types';
import { theatreState } from './state';
import { projectPath, kanbanVisible, terminals, activeIndex, invalidateTaskList } from './signals';
import { theatreRegistry, showTaskContextMenu } from './helpers';
import { reopenTask, deleteTask, closeTask } from './worktreeDropdown';
import { switchToTheatreTerminal } from './terminalCards';
import { hideTaskIndex } from './taskIndex';
import { escapeHtml } from '../../utils/html';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes, platformHotkey } from '../../utils/hotkeys';

/** Column definitions matching TaskStatus values */
const KANBAN_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];

/**
 * Build the kanban board HTML shell
 */
function buildKanbanHtml(): string {
  const columnsHtml = KANBAN_COLUMNS.map(col => `
    <div class="kanban-column" data-status="${col.status}">
      <div class="kanban-column-header">
        <span class="kanban-column-title">${col.label}</span>
        <span class="kanban-column-count">0</span>
        ${col.status === 'todo' ? '<button class="kanban-add-btn" title="Add task" style="-webkit-app-region: no-drag;"><i data-lucide="plus"></i></button>' : ''}
      </div>
      <div class="kanban-column-body"></div>
    </div>
  `).join('');

  return `
    <div class="kanban-board">
      <div class="kanban-columns">${columnsHtml}</div>
    </div>
  `;
}

/**
 * Build a kanban card DOM element for a task
 */
function buildKanbanCard(task: TaskWithWorkspace, path: string, limaAvailable: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.draggable = true;
  card.dataset.taskNumber = String(task.taskNumber);
  card.setAttribute('style', '-webkit-app-region: no-drag;');

  // Header row (status dot is managed by syncKanbanStatusDots)
  const header = document.createElement('div');
  header.className = 'kanban-card-header';

  const name = document.createElement('span');
  name.className = 'kanban-card-name';
  name.textContent = task.name;
  header.appendChild(name);

  const expandBtn = document.createElement('button');
  expandBtn.className = 'kanban-card-expand';
  expandBtn.innerHTML = '<i data-lucide="chevron-down"></i>';
  expandBtn.setAttribute('style', '-webkit-app-region: no-drag;');
  header.appendChild(expandBtn);

  card.appendChild(header);

  // Detail section (hidden by default)
  const detail = document.createElement('div');
  detail.className = 'kanban-card-detail';
  detail.style.display = 'none';

  if (task.branch) {
    const branchRow = document.createElement('div');
    branchRow.className = 'kanban-card-detail-row';
    branchRow.innerHTML = `<span class="kanban-card-detail-label">Branch</span><span class="kanban-card-detail-value">${escapeHtml(task.branch)}</span>`;
    detail.appendChild(branchRow);
  }

  if (task.prompt) {
    const promptRow = document.createElement('div');
    promptRow.className = 'kanban-card-detail-row';
    promptRow.innerHTML = `<span class="kanban-card-detail-label">Prompt</span><span class="kanban-card-detail-value kanban-card-detail-value--clamp">${escapeHtml(task.prompt)}</span>`;
    detail.appendChild(promptRow);
  }

  const dateRow = document.createElement('div');
  dateRow.className = 'kanban-card-detail-row';
  const date = new Date(task.createdAt);
  dateRow.innerHTML = `<span class="kanban-card-detail-label">Created</span><span class="kanban-card-detail-value">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
  detail.appendChild(dateRow);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'kanban-card-actions';

  if (task.status === 'done') {
    const reopenBtn = document.createElement('button');
    reopenBtn.className = 'kanban-card-action';
    reopenBtn.title = 'Reopen task';
    reopenBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
    reopenBtn.setAttribute('style', '-webkit-app-region: no-drag;');
    reopenBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await reopenTask(path, task);
    });
    actions.appendChild(reopenBtn);
  } else {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'kanban-card-action';
    closeBtn.title = 'Close task';
    closeBtn.innerHTML = '<i data-lucide="archive"></i>';
    closeBtn.setAttribute('style', '-webkit-app-region: no-drag;');
    closeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await closeTask(path, task);
    });
    actions.appendChild(closeBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'kanban-card-action kanban-card-action--danger';
  delBtn.title = 'Delete task';
  delBtn.innerHTML = '<i data-lucide="trash-2"></i>';
  delBtn.setAttribute('style', '-webkit-app-region: no-drag;');
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteTask(path, task);
  });
  actions.appendChild(delBtn);

  detail.appendChild(actions);
  card.appendChild(detail);

  // Expand toggle
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = detail.style.display !== 'none';
    detail.style.display = isExpanded ? 'none' : 'block';
    expandBtn.classList.toggle('kanban-card-expand--open', !isExpanded);
  });

  // Click to open terminal — switch to existing session if one is open
  card.addEventListener('click', async () => {
    // If there's already a terminal open for this task, just switch to it
    const existingIdx = terminals.value.findIndex(t => t.taskId === task.taskNumber);
    if (existingIdx !== -1) {
      hideKanbanBoard();
      if (existingIdx !== activeIndex.value) {
        switchToTheatreTerminal(existingIdx);
      }
      return;
    }

    if (task.status === 'done') {
      hideKanbanBoard();
      await reopenTask(path, task);
      return;
    }

    // Todo task with no worktree — create one first
    if (!task.worktreePath) {
      const startResult = await window.api.task.start(path, task.taskNumber);
      if (!startResult.success || !startResult.worktreePath) return;
      invalidateTaskList();
      hideKanbanBoard();
      await theatreRegistry.addTheatreTerminal?.(undefined, {
        existingWorktree: {
          path: startResult.worktreePath,
          branch: startResult.task?.branch || '',
          createdAt: task.createdAt,
          sandboxed: task.sandboxed,
        },
        taskId: task.taskNumber,
        sandboxed: false,
      });
      return;
    }

    // Task already has a worktree
    hideKanbanBoard();
    await theatreRegistry.addTheatreTerminal?.(undefined, {
      existingWorktree: {
        path: task.worktreePath,
        branch: task.branch || '',
        createdAt: task.createdAt,
        sandboxed: task.sandboxed,
      },
      taskId: task.taskNumber,
      sandboxed: false,
    });
  });

  // Drag handlers
  card.addEventListener('dragstart', (e) => {
    card.classList.add('kanban-card--dragging');
    e.dataTransfer?.setData('text/plain', String(task.taskNumber));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('kanban-card--dragging');
  });

  // Right-click context menu (sandbox option)
  if (limaAvailable) {
    card.addEventListener('contextmenu', (e) => {
      showTaskContextMenu(e, async () => {
        hideKanbanBoard();
        const worktreeOpts = {
          path: task.worktreePath || '',
          branch: task.branch || '',
          createdAt: task.createdAt,
          sandboxed: task.sandboxed,
        };
        if (task.status === 'done') {
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

  return card;
}

/**
 * Set up drag-and-drop targets on column bodies
 */
function setupColumnDropTargets(): void {
  const board = document.querySelector('.kanban-board');
  if (!board) return;

  const columns = board.querySelectorAll('.kanban-column');
  columns.forEach(column => {
    const body = column.querySelector('.kanban-column-body') as HTMLElement;
    if (!body) return;

    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      column.classList.add('kanban-column--drop-target');
    });

    body.addEventListener('dragleave', (e) => {
      // Only remove if leaving the column body, not entering a child
      if (!body.contains(e.relatedTarget as Node)) {
        column.classList.remove('kanban-column--drop-target');
      }
    });

    body.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('kanban-column--drop-target');

      const taskNumber = parseInt(e.dataTransfer?.getData('text/plain') || '', 10);
      if (isNaN(taskNumber)) return;

      const newStatus = (column as HTMLElement).dataset.status as TaskStatus;
      if (!newStatus) return;

      const path = projectPath.value;
      if (!path) return;

      // Dropping a todo task (no worktree) into in_progress — create worktree + show start command dialog
      if (newStatus === 'in_progress') {
        const tasks = await window.api.task.getAll(path);
        const task = tasks.find(t => t.taskNumber === taskNumber);

        if (task && !task.worktreePath) {
          // Create the worktree first
          const startResult = await window.api.task.start(path, taskNumber);
          if (!startResult.success || !startResult.worktreePath) return;
          invalidateTaskList();

          // Show start command dialog
          const dialogResult = await showStartCommandDialog(path, task.name);
          if (dialogResult === null) {
            // User cancelled — abort (worktree was created but that's fine)
            await populateKanbanBoard();
            return;
          }

          // Build runConfig if user chose to run a command
          let runConfig: RunConfig | undefined;
          if (dialogResult !== 'skip' && dialogResult.command) {
            runConfig = {
              name: 'start',
              command: dialogResult.command,
              source: 'custom',
              priority: 0,
            };
          }

          await theatreRegistry.addTheatreTerminal?.(runConfig, {
            existingWorktree: {
              path: startResult.worktreePath,
              branch: startResult.task?.branch || '',
              createdAt: task.createdAt,
              sandboxed: task.sandboxed,
            },
            taskId: taskNumber,
            sandboxed: false,
          });
          await populateKanbanBoard();
          return;
        }
      }

      const result = await window.api.task.setStatus(path, taskNumber, newStatus);
      if (result.success) {
        invalidateTaskList();
        await populateKanbanBoard();
      }
    });
  });
}

/**
 * Populate the kanban board with tasks
 */
async function populateKanbanBoard(): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  const board = document.querySelector('.kanban-board');
  if (!board) return;

  const [tasks, limaAvailable] = await Promise.all([
    window.api.task.getAll(path),
    window.api.lima.status(path).then(s => s.available).catch(() => false),
  ]);

  // Distribute tasks into columns
  for (const col of KANBAN_COLUMNS) {
    const column = board.querySelector(`.kanban-column[data-status="${col.status}"]`);
    if (!column) continue;

    const body = column.querySelector('.kanban-column-body') as HTMLElement;
    const count = column.querySelector('.kanban-column-count') as HTMLElement;
    if (!body) continue;

    body.innerHTML = '';
    const columnTasks = tasks.filter(t => t.status === col.status);

    if (count) count.textContent = String(columnTasks.length);

    for (const task of columnTasks) {
      const card = buildKanbanCard(task, path, limaAvailable);
      body.appendChild(card);
    }
  }

  // Render lucide icons
  import('lucide').then(({ createIcons, icons }) => {
    createIcons({ icons, nameAttr: 'data-lucide', attrs: {}, nodes: [board as HTMLElement] });
  });

  // Sync status dots with current terminal state
  syncKanbanStatusDots();
}

/**
 * Prompt for a task name and create a todo task (no terminal)
 */
async function addTodoTask(): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  const todoColumn = document.querySelector('.kanban-column[data-status="todo"]');
  if (!todoColumn) return;
  const body = todoColumn.querySelector('.kanban-column-body') as HTMLElement;
  if (!body) return;

  // Create inline input at the top of the todo column
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'kanban-add-input';
  input.placeholder = 'Task name...';
  input.setAttribute('style', '-webkit-app-region: no-drag;');
  body.prepend(input);
  input.focus();

  let submitting = false;

  const cleanup = () => {
    if (input.parentNode) input.remove();
  };

  const submit = async () => {
    const name = input.value.trim();
    submitting = true;
    cleanup();
    if (!name) return;
    await window.api.task.create(path, name);
    invalidateTaskList();
    await populateKanbanBoard();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  });

  input.addEventListener('blur', () => {
    if (!submitting) cleanup();
  });
}

/**
 * Show a start command dialog before opening a terminal.
 * Returns { command: string } to run a command, 'skip' to open terminal with no command, or null to cancel.
 */
function showStartCommandDialog(path: string, taskName: string): Promise<{ command: string } | 'skip' | null> {
  return new Promise(async (resolve) => {
    let resolved = false;
    const finish = (result: { command: string } | 'skip' | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Fetch start hook command
    let startCommand = '';
    try {
      const hooks = await window.api.hooks.get(path);
      if (hooks.start?.command) startCommand = hooks.start.command;
    } catch { /* no hook configured */ }

    // Build overlay + dialog
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';

    const title = document.createElement('div');
    title.className = 'import-dialog-title';
    title.textContent = 'Start Command';
    dialog.appendChild(title);

    // Textarea for the command
    const textarea = document.createElement('textarea');
    textarea.className = 'form-input form-textarea start-command-textarea';
    textarea.value = startCommand;
    textarea.placeholder = 'e.g. npm run dev';
    textarea.rows = 3;
    textarea.setAttribute('style', '-webkit-app-region: no-drag;');
    dialog.appendChild(textarea);

    // Environment variables hint
    const envHint = document.createElement('details');
    envHint.className = 'hook-env-vars';
    envHint.innerHTML = `<summary>Available environment variables</summary>
<ul>
  <li><code>OUIJIT_TASK_NAME</code> — ${escapeHtml(taskName)}</li>
  <li><code>OUIJIT_PROJECT_PATH</code></li>
  <li><code>OUIJIT_WORKTREE_PATH</code></li>
  <li><code>OUIJIT_BRANCH</code></li>
</ul>`;
    dialog.appendChild(envHint);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'import-actions';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-secondary';
    skipBtn.textContent = 'Skip';
    skipBtn.setAttribute('style', '-webkit-app-region: no-drag;');
    skipBtn.addEventListener('click', () => finish('skip'));
    actions.appendChild(skipBtn);

    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-primary';
    runBtn.textContent = 'Run';
    runBtn.setAttribute('style', '-webkit-app-region: no-drag;');
    runBtn.addEventListener('click', () => {
      const cmd = textarea.value.trim();
      if (cmd) {
        finish({ command: cmd });
      } else {
        finish('skip');
      }
    });
    actions.appendChild(runBtn);

    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Scope + hotkeys
    pushScope(Scopes.MODAL);

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      popScope();
      dialog.classList.remove('import-dialog--visible');
      overlay.classList.remove('modal-overlay--visible');
      setTimeout(() => overlay.remove(), 150);
    };

    registerHotkey('escape', Scopes.MODAL, () => finish(null));

    // Click outside cancels
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) finish(null);
    });

    // Enter in textarea submits (Shift+Enter for newline)
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        runBtn.click();
      }
    });

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('import-dialog--visible');
      textarea.focus();
    });
  });
}

/**
 * Sync all kanban card status dots with current terminal state.
 * Creates, updates, or removes dots as needed.
 */
export function syncKanbanStatusDots(): void {
  const cards = document.querySelectorAll('.kanban-card[data-task-number]');
  const terminalList = terminals.value;
  cards.forEach(card => {
    const taskNumber = parseInt((card as HTMLElement).dataset.taskNumber || '', 10);
    if (isNaN(taskNumber)) return;

    const header = card.querySelector('.kanban-card-header');
    if (!header) return;

    const term = terminalList.find(t => t.taskId === taskNumber);
    let dot = header.querySelector('.kanban-card-status-dot') as HTMLElement | null;

    if (term) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'kanban-card-status-dot';
        header.insertBefore(dot, header.firstChild);
      }
      dot.setAttribute('data-status', term.summaryType);
      const isSandboxed = term.container.querySelector('.theatre-card-status-dot--sandboxed') !== null;
      dot.classList.toggle('kanban-card-status-dot--sandboxed', isSandboxed);
    } else if (dot) {
      dot.remove();
    }
  });
}

/**
 * Show the kanban board
 */
export async function showKanbanBoard(): Promise<void> {
  if (kanbanVisible.value) return;
  kanbanVisible.value = true;

  // Close task index if open
  hideTaskIndex();

  const mainContent = document.querySelector('.main-content');
  if (!mainContent) {
    kanbanVisible.value = false;
    return;
  }

  // Create board DOM
  mainContent.insertAdjacentHTML('beforeend', buildKanbanHtml());
  const board = document.querySelector('.kanban-board');
  if (!board) {
    kanbanVisible.value = false;
    return;
  }

  // Wire up add button in the todo column
  const addBtn = board.querySelector('.kanban-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => addTodoTask());
  }

  // Set up drop targets
  setupColumnDropTargets();

  // Populate with tasks
  await populateKanbanBoard();

  // Blur the active terminal so hotkeys (especially Escape) aren't captured by xterm
  const activeEl = document.activeElement as HTMLElement | null;
  if (activeEl?.closest('.xterm')) {
    activeEl.blur();
  }

  // Add body class to hide the stack
  document.body.classList.add('kanban-open');

  // Animate in
  requestAnimationFrame(() => {
    board.classList.add('kanban-board--visible');
  });

  // Push scope and register hotkeys
  pushScope(Scopes.KANBAN);

  registerHotkey('escape', Scopes.KANBAN, () => {
    hideKanbanBoard();
  });

  registerHotkey(platformHotkey('mod+b'), Scopes.KANBAN, () => {
    hideKanbanBoard();
  });

  registerHotkey(platformHotkey('mod+n'), Scopes.KANBAN, () => {
    addTodoTask();
  });

  theatreState.kanbanCleanup = () => {
    unregisterHotkey('escape', Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+b'), Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+n'), Scopes.KANBAN);
    popScope();
  };
}

/**
 * Hide the kanban board
 */
export function hideKanbanBoard(): void {
  if (!kanbanVisible.value) return;

  const board = document.querySelector('.kanban-board');
  if (board) {
    board.classList.remove('kanban-board--visible');
    setTimeout(() => board.remove(), 200);
  }

  document.body.classList.remove('kanban-open');

  if (theatreState.kanbanCleanup) {
    theatreState.kanbanCleanup();
    theatreState.kanbanCleanup = null;
  }

  kanbanVisible.value = false;
}

/**
 * Toggle kanban board visibility
 */
export function toggleKanbanBoard(): void {
  if (kanbanVisible.value) {
    hideKanbanBoard();
  } else {
    showKanbanBoard();
  }
}

/**
 * Refresh the kanban board if it's visible
 */
export async function refreshKanbanBoard(): Promise<void> {
  if (kanbanVisible.value) {
    await populateKanbanBoard();
  }
}

// Register in the theatre registry for cross-module access
theatreRegistry.toggleKanbanBoard = toggleKanbanBoard;
theatreRegistry.syncKanbanStatusDots = syncKanbanStatusDots;
