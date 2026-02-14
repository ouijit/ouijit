/**
 * Kanban board view — spatial task management with drag-and-drop
 */

import type { TaskWithWorkspace, TaskStatus } from '../../types';
import { theatreState } from './state';
import { projectPath, kanbanVisible, terminals, activeIndex, invalidateTaskList } from './signals';
import { theatreRegistry, showTaskContextMenu } from './helpers';
import { reopenTask, deleteTask, closeTask } from './worktreeDropdown';
import { switchToTheatreTerminal } from './terminalCards';
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

  // Look up terminal for this task to get status dot info
  const matchingTerminal = terminals.value.find(t => t.taskId === task.taskNumber);

  // Header row
  const header = document.createElement('div');
  header.className = 'kanban-card-header';

  // Only show status dot if there's an active terminal session for this task
  if (matchingTerminal) {
    const dot = document.createElement('span');
    dot.className = 'kanban-card-status-dot';
    dot.setAttribute('data-status', matchingTerminal.summaryType);
    const isSandboxed = matchingTerminal.container.querySelector('.theatre-card-status-dot--sandboxed') !== null;
    if (isSandboxed) dot.classList.add('kanban-card-status-dot--sandboxed');
    header.appendChild(dot);
  }

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
    hideKanbanBoard();

    // If there's already a terminal open for this task, just switch to it
    const existingIdx = terminals.value.findIndex(t => t.taskId === task.taskNumber);
    if (existingIdx !== -1) {
      if (existingIdx !== activeIndex.value) {
        switchToTheatreTerminal(existingIdx);
      }
      return;
    }

    const worktreeOpts = {
      path: task.worktreePath || '',
      branch: task.branch || '',
      createdAt: task.createdAt,
      sandboxed: task.sandboxed,
    };

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
}

/**
 * Show the kanban board
 */
export async function showKanbanBoard(): Promise<void> {
  if (kanbanVisible.value) return;
  kanbanVisible.value = true;

  // Close task index if open
  const { hideTaskIndex } = await import('./taskIndex');
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

  theatreState.kanbanCleanup = () => {
    unregisterHotkey('escape', Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+b'), Scopes.KANBAN);
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
