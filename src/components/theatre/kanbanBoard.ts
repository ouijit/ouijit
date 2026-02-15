/**
 * Kanban board view — spatial task management with drag-and-drop
 */

import type { TaskWithWorkspace, TaskStatus, RunConfig } from '../../types';
import type { TheatreTerminal } from './state';
import { theatreState } from './state';
import { projectPath, kanbanVisible, terminals, activeIndex, invalidateTaskList } from './signals';
import { theatreRegistry } from './helpers';
import { reopenTask, deleteTask, closeTask } from './worktreeDropdown';
import { switchToTheatreTerminal } from './terminalCards';
import { escapeHtml } from '../../utils/html';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes, platformHotkey } from '../../utils/hotkeys';
import { createIcons, icons } from 'lucide';

/**
 * Sync the view toggle buttons' active state with kanban visibility
 */
export function syncViewToggle(): void {
  const btns = document.querySelectorAll('.theatre-view-toggle-btn');
  btns.forEach(btn => {
    const view = (btn as HTMLElement).dataset.view;
    const isBoard = view === 'board';
    btn.classList.toggle('theatre-view-toggle-btn--active', isBoard === kanbanVisible.value);
  });
}

/**
 * Show a context menu for a kanban card with terminal/sandbox options
 */
function showKanbanCardContextMenu(
  event: MouseEvent,
  onOpenTerminal: () => void,
  onSandbox: (() => void) | null,
  onOpenInEditor: (() => void) | null,
  connectedTerminals: { terminal: TheatreTerminal; index: number }[],
  onSwitchTerminal: (index: number) => void,
  onCloseOrReopen: () => void,
  closeOrReopenLabel: string,
  onDelete: () => void,
): void {
  event.preventDefault();
  event.stopPropagation();

  // Remove any existing context menu
  document.querySelector('.task-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';

  // Connected terminals listed first (no icons)
  if (connectedTerminals.length > 0) {
    for (const { terminal, index } of connectedTerminals) {
      const item = document.createElement('button');
      item.className = 'task-context-menu-item';
      const dot = document.createElement('span');
      dot.className = 'kanban-card-status-dot';
      dot.setAttribute('data-status', terminal.summaryType);
      item.appendChild(dot);
      // Show distinguishing info instead of repeating the task title
      let menuLabel: string;
      if (terminal.command) {
        menuLabel = terminal.command.length > 40
          ? terminal.command.slice(0, 40) + '…'
          : terminal.command;
      } else if (terminal.lastOscTitle) {
        const cleaned = terminal.lastOscTitle.replace(/\p{Extended_Pictographic}/gu, '').trim();
        if (cleaned) {
          menuLabel = cleaned.length > 40 ? cleaned.slice(0, 40) + '…' : cleaned;
        } else {
          menuLabel = 'Shell';
        }
      } else {
        menuLabel = 'Shell';
      }
      if (terminal.summary) {
        menuLabel += ` — ${terminal.summary}`;
      }
      item.appendChild(document.createTextNode(menuLabel));
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        onSwitchTerminal(index);
      });
      menu.appendChild(item);
    }

    const separator = document.createElement('div');
    separator.className = 'task-context-menu-separator';
    menu.appendChild(separator);
  }

  // "Open in Terminal" option
  const terminalItem = document.createElement('button');
  terminalItem.className = 'task-context-menu-item';
  terminalItem.innerHTML = '<i data-lucide="terminal"></i> Open in Terminal';
  terminalItem.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    onOpenTerminal();
  });
  menu.appendChild(terminalItem);

  // "Open in Sandbox" option (only if lima is available)
  if (onSandbox) {
    const sandboxItem = document.createElement('button');
    sandboxItem.className = 'task-context-menu-item';
    sandboxItem.innerHTML = '<i data-lucide="box"></i> Open in Sandbox';
    sandboxItem.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      onSandbox();
    });
    menu.appendChild(sandboxItem);
  }

  // "Open in Editor" option (only if task has a worktree path)
  if (onOpenInEditor) {
    const editorItem = document.createElement('button');
    editorItem.className = 'task-context-menu-item';
    editorItem.innerHTML = '<i data-lucide="code"></i> Open in Editor';
    editorItem.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      onOpenInEditor();
    });
    menu.appendChild(editorItem);
  }

  // Separator before task actions
  const actionSeparator = document.createElement('div');
  actionSeparator.className = 'task-context-menu-separator';
  menu.appendChild(actionSeparator);

  // Close/Reopen option
  const closeReopenItem = document.createElement('button');
  closeReopenItem.className = 'task-context-menu-item';
  const closeReopenIcon = closeOrReopenLabel === 'Reopen' ? 'rotate-ccw' : 'archive';
  closeReopenItem.innerHTML = `<i data-lucide="${closeReopenIcon}"></i> ${closeOrReopenLabel}`;
  closeReopenItem.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    onCloseOrReopen();
  });
  menu.appendChild(closeReopenItem);

  // Delete option
  const deleteItem = document.createElement('button');
  deleteItem.className = 'task-context-menu-item task-context-menu-item--danger';
  deleteItem.innerHTML = '<i data-lucide="trash-2"></i> Delete';
  deleteItem.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    onDelete();
  });
  menu.appendChild(deleteItem);

  document.body.appendChild(menu);

  // Render lucide icons
  createIcons({ icons, nameAttr: 'data-lucide', attrs: {}, nodes: [menu] });

  // Position at mouse, keeping within viewport
  const menuWidth = 200;
  const itemCount = 1 + (onSandbox ? 1 : 0) + (onOpenInEditor ? 1 : 0) + connectedTerminals.length + 2; // +2 for close/reopen and delete
  const separatorCount = (connectedTerminals.length > 0 ? 1 : 0) + 1; // +1 for action separator
  const menuHeight = 32 * itemCount + 9 * separatorCount;
  const x = Math.min(event.clientX, window.innerWidth - menuWidth);
  const y = Math.min(event.clientY, window.innerHeight - menuHeight);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Animate in
  requestAnimationFrame(() => menu.classList.add('task-context-menu--visible'));

  // Dismiss on click outside
  const dismiss = (e: MouseEvent) => {
    if (menu.contains(e.target as Node)) return;
    menu.classList.remove('task-context-menu--visible');
    setTimeout(() => menu.remove(), 100);
    document.removeEventListener('mousedown', dismiss);
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

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
      <div class="kanban-column-body">
        ${col.status === 'todo' ? '<input type="text" class="kanban-add-input" placeholder="New task..." style="-webkit-app-region: no-drag;" />' : ''}
      </div>
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
function buildKanbanCard(task: TaskWithWorkspace, path: string, limaAvailable: boolean, editorConfigured: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'kanban-card' + (task.status === 'done' ? ' kanban-card--done' : '');
  card.draggable = true;
  card.dataset.taskNumber = String(task.taskNumber);
  card.setAttribute('style', '-webkit-app-region: no-drag;');

  // Header row (status dot is managed by syncKanbanStatusDots)
  const header = document.createElement('div');
  header.className = 'kanban-card-header';

  const name = document.createElement('span');
  name.className = 'kanban-card-name';
  name.textContent = task.name;

  // Double-click to edit title inline
  name.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    clearTimeout(clickTimer);

    const input = document.createElement('textarea');
    input.className = 'kanban-card-name-input';
    input.value = task.name;
    input.rows = 1;
    input.setAttribute('style', '-webkit-app-region: no-drag;');

    const autoResize = () => {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    };

    let cancelled = false;

    const restoreName = () => {
      name.textContent = task.name;
      header.replaceChild(name, input);
    };

    const commit = async () => {
      if (cancelled) return;
      const newName = input.value.trim();
      if (newName && newName !== task.name) {
        const result = await window.api.task.setName(path, task.taskNumber, newName);
        if (result.success) {
          task.name = newName;
          invalidateTaskList();
        }
      }
      restoreName();
    };

    input.addEventListener('input', autoResize);
    input.addEventListener('blur', () => commit());
    input.addEventListener('keydown', (ke) => {
      ke.stopPropagation();
      if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
      if (ke.key === 'Escape') { ke.preventDefault(); cancelled = true; restoreName(); }
    });

    header.replaceChild(input, name);
    input.focus();
    input.select();
    autoResize();
  });

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

  if (task.branch) {
    const branchRow = document.createElement('div');
    branchRow.className = 'kanban-card-branch';
    branchRow.innerHTML = `<i data-lucide="git-branch"></i><span class="kanban-card-branch-name">${escapeHtml(task.branch)}</span>`;
    detail.appendChild(branchRow);
  }

  // Description row — always visible, with placeholder when empty
  const promptRow = document.createElement('div');
  promptRow.className = 'kanban-card-detail-row';

  const promptLabel = document.createElement('span');
  promptLabel.className = 'kanban-card-detail-label';
  promptLabel.textContent = 'Description';
  promptRow.appendChild(promptLabel);

  const promptValue = document.createElement('span');
  promptValue.className = 'kanban-card-detail-value' + (task.prompt ? ' kanban-card-detail-value--clamp' : ' kanban-card-detail-value--placeholder');
  promptValue.textContent = task.prompt || 'Add description...';
  promptRow.appendChild(promptValue);

  // Enter description edit mode
  const startDescriptionEdit = () => {
    const textarea = document.createElement('textarea');
    textarea.className = 'kanban-card-description-textarea';
    textarea.value = task.prompt || '';
    textarea.setAttribute('style', '-webkit-app-region: no-drag;');
    let cancelled = false;

    const restorePromptValue = () => {
      promptValue.textContent = task.prompt || 'Add description...';
      promptValue.className = 'kanban-card-detail-value' + (task.prompt ? ' kanban-card-detail-value--clamp' : ' kanban-card-detail-value--placeholder');
      promptRow.replaceChild(promptValue, textarea);
    };

    const commitDesc = async () => {
      if (cancelled) return;
      const newDesc = textarea.value.trim();
      if (newDesc !== (task.prompt || '')) {
        const result = await window.api.task.setDescription(path, task.taskNumber, newDesc);
        if (result.success) {
          task.prompt = newDesc || undefined;
          invalidateTaskList();
        }
      }
      restorePromptValue();
    };

    textarea.addEventListener('blur', () => commitDesc());
    textarea.addEventListener('keydown', (ke) => {
      ke.stopPropagation();
      if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); textarea.blur(); }
      if (ke.key === 'Escape') { ke.preventDefault(); cancelled = true; restorePromptValue(); }
    });

    promptRow.replaceChild(textarea, promptValue);
    textarea.focus();
  };

  // Double-click to edit existing description
  promptValue.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    clearTimeout(clickTimer);
    startDescriptionEdit();
  });

  // Single click on placeholder to start editing
  promptValue.addEventListener('click', (e) => {
    if (!task.prompt) {
      e.stopPropagation();
      clearTimeout(clickTimer);
      startDescriptionEdit();
    }
  });

  detail.appendChild(promptRow);

  const dateRow = document.createElement('div');
  dateRow.className = 'kanban-card-detail-row';
  const date = new Date(task.createdAt);
  dateRow.innerHTML = `<span class="kanban-card-detail-label">Created</span><span class="kanban-card-detail-value">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
  detail.appendChild(dateRow);

  card.appendChild(detail);

  // Click anywhere on card toggles expand/collapse
  let clickTimer: ReturnType<typeof setTimeout>;

  const toggleExpand = () => {
    const isExpanded = detail.classList.toggle('kanban-card-detail--visible');
    expandBtn.classList.toggle('kanban-card-expand--open', isExpanded);
    card.classList.toggle('kanban-card--expanded', isExpanded);
  };

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand();
  });

  card.addEventListener('click', (e) => {
    clearTimeout(clickTimer);
    // Only delay for elements that support double-click editing
    const target = e.target as HTMLElement;
    if (target.closest('.kanban-card-name, .kanban-card-detail-value')) {
      clickTimer = setTimeout(() => toggleExpand(), 200);
    } else {
      toggleExpand();
    }
  });

  card.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
  });

  // Drag handlers
  card.addEventListener('dragstart', (e) => {
    // Prevent drag when editing inline
    if (card.querySelector('.kanban-card-name-input, .kanban-card-description-textarea')) {
      e.preventDefault();
      return;
    }
    card.classList.add('kanban-card--dragging');
    e.dataTransfer?.setData('text/plain', String(task.taskNumber));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('kanban-card--dragging');
  });

  // Right-click context menu
  card.addEventListener('contextmenu', (e) => {
    const connectedTerminals = terminals.value
      .map((t, i) => ({ terminal: t, index: i }))
      .filter(({ terminal: t }) => t.taskId === task.taskNumber);

    const onOpenTerminal = async () => {
      if (task.status === 'done') {
        hideKanbanBoard();
        await reopenTask(path, task);
        return;
      }
      if (!task.worktreePath) {
        const startResult = await window.api.task.start(path, task.taskNumber);
        if (!startResult.success || !startResult.worktreePath) return;
        await window.api.task.setStatus(path, task.taskNumber, 'in_progress');
        invalidateTaskList();
        hideKanbanBoard();
        await theatreRegistry.addTheatreTerminal?.(undefined, {
          existingWorktree: {
            path: startResult.worktreePath,
            branch: startResult.task?.branch || '',
            taskName: task.name,
            prompt: task.prompt,
            createdAt: task.createdAt,
            sandboxed: task.sandboxed,
          },
          taskId: task.taskNumber,
          sandboxed: false,
        });
        return;
      }
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
    };

    const onSandbox = limaAvailable ? async () => {
      if (task.status === 'done') {
        const worktreeOpts = {
          path: task.worktreePath!,
          branch: task.branch || '',
          taskName: task.name,
          prompt: task.prompt,
          createdAt: task.createdAt,
          sandboxed: task.sandboxed,
        };
        const result = await window.api.task.setStatus(path, task.taskNumber, 'in_progress');
        if (result.success) {
          invalidateTaskList();
          hideKanbanBoard();
          await theatreRegistry.addTheatreTerminal?.(undefined, {
            existingWorktree: worktreeOpts,
            taskId: task.taskNumber,
            sandboxed: true,
          });
        }
      } else if (!task.worktreePath) {
        const startResult = await window.api.task.start(path, task.taskNumber);
        if (!startResult.success || !startResult.worktreePath) return;
        await window.api.task.setStatus(path, task.taskNumber, 'in_progress');
        invalidateTaskList();
        hideKanbanBoard();
        await theatreRegistry.addTheatreTerminal?.(undefined, {
          existingWorktree: {
            path: startResult.worktreePath,
            branch: startResult.task?.branch || '',
            taskName: task.name,
            prompt: task.prompt,
            createdAt: task.createdAt,
            sandboxed: task.sandboxed,
          },
          taskId: task.taskNumber,
          sandboxed: true,
        });
      } else {
        hideKanbanBoard();
        await theatreRegistry.addTheatreTerminal?.(undefined, {
          existingWorktree: {
            path: task.worktreePath,
            branch: task.branch || '',
            taskName: task.name,
            prompt: task.prompt,
            createdAt: task.createdAt,
            sandboxed: task.sandboxed,
          },
          taskId: task.taskNumber,
          sandboxed: true,
        });
      }
    } : null;

    const onSwitchTerminal = (idx: number) => {
      hideKanbanBoard();
      if (idx !== activeIndex.value) {
        switchToTheatreTerminal(idx);
      }
    };

    const onCloseOrReopen = async () => {
      if (task.status === 'done') {
        await reopenTask(path, task);
      } else {
        await closeTask(path, task);
      }
    };
    const closeOrReopenLabel = task.status === 'done' ? 'Reopen' : 'Move to Done';

    const onDelete = async () => {
      await deleteTask(path, task);
    };

    const onOpenInEditor = (editorConfigured && task.worktreePath) ? () => {
      window.api.openInEditor(path, task.worktreePath!);
    } : null;

    showKanbanCardContextMenu(e, onOpenTerminal, onSandbox, onOpenInEditor, connectedTerminals, onSwitchTerminal, onCloseOrReopen, closeOrReopenLabel, onDelete);
  });

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

      // Immediately move the card into the target column so there's no snap-back
      const card = board!.querySelector(`.kanban-card[data-task-number="${taskNumber}"]`) as HTMLElement | null;
      const originalBody = card?.parentElement;
      const originalNext = card?.nextElementSibling || null;
      if (card) body.appendChild(card);

      // Dropping a task into in_progress — create worktree if needed + show start command dialog
      if (newStatus === 'in_progress') {
        const tasks = await window.api.task.getAll(path);
        const task = tasks.find(t => t.taskNumber === taskNumber);

        if (task && task.status === 'todo') {
          let worktreePath = task.worktreePath;
          let branch = task.branch || '';

          // Create worktree if task doesn't have one yet
          if (!worktreePath) {
            const startResult = await window.api.task.start(path, taskNumber);
            if (!startResult.success || !startResult.worktreePath) {
              if (card && originalBody) originalBody.insertBefore(card, originalNext);
              return;
            }
            worktreePath = startResult.worktreePath;
            branch = startResult.task?.branch || '';
          }

          await window.api.task.setStatus(path, taskNumber, 'in_progress');
          invalidateTaskList();

          // Show start command dialog
          const dialogResult = await showStartCommandDialog(path, task.name);
          if (dialogResult === null) {
            // User cancelled — task stays in_progress but no terminal opened
            await populateKanbanBoard();
            return;
          }

          // Build runConfig if user chose to run a command
          let runConfig: RunConfig | undefined;
          const sandboxed = dialogResult.sandboxed;
          if (dialogResult.command) {
            runConfig = {
              name: 'start',
              command: dialogResult.command,
              source: 'custom',
              priority: 0,
            };
          }

          await theatreRegistry.addTheatreTerminal?.(runConfig, {
            existingWorktree: {
              path: worktreePath,
              branch,
              taskName: task.name,
              prompt: task.prompt,
              createdAt: task.createdAt,
              sandboxed: task.sandboxed,
            },
            taskId: taskNumber,
            sandboxed,
          });
          await populateKanbanBoard();
          return;
        }
      }

      if (newStatus === 'done') {
        const tasks = await window.api.task.getAll(path);
        const task = tasks.find(t => t.taskNumber === taskNumber);
        if (task) {
          await closeTask(path, task);
          await populateKanbanBoard();
        }
        return;
      }

      const result = await window.api.task.setStatus(path, taskNumber, newStatus);
      if (result.success) {
        invalidateTaskList();
        await populateKanbanBoard();
      } else if (card && originalBody) {
        originalBody.insertBefore(card, originalNext);
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

  const [tasks, limaAvailable, hooks] = await Promise.all([
    window.api.task.getAll(path),
    window.api.lima.status(path).then(s => s.available).catch(() => false),
    window.api.hooks.get(path).catch(() => ({} as Awaited<ReturnType<typeof window.api.hooks.get>>)),
  ]);
  const editorConfigured = !!hooks.editor;

  // Distribute tasks into columns
  for (const col of KANBAN_COLUMNS) {
    const column = board.querySelector(`.kanban-column[data-status="${col.status}"]`);
    if (!column) continue;

    const body = column.querySelector('.kanban-column-body') as HTMLElement;
    const count = column.querySelector('.kanban-column-count') as HTMLElement;
    if (!body) continue;

    // Preserve the persistent input if present
    const persistentInput = body.querySelector('.kanban-add-input') as HTMLInputElement | null;
    body.innerHTML = '';
    const columnTasks = tasks.filter(t => t.status === col.status)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (count) count.textContent = String(columnTasks.length);

    for (const task of columnTasks) {
      const card = buildKanbanCard(task, path, limaAvailable, editorConfigured);
      body.appendChild(card);
    }

    // Re-append the persistent input at the end of the todo column
    if (col.status === 'todo') {
      if (persistentInput) {
        body.appendChild(persistentInput);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'kanban-add-input';
        input.placeholder = 'New task...';
        input.setAttribute('style', '-webkit-app-region: no-drag;');
        body.appendChild(input);
      }
    }
  }

  // Render lucide icons
  createIcons({ icons, nameAttr: 'data-lucide', attrs: {}, nodes: [board as HTMLElement] });

  // Sync status dots with current terminal state
  syncKanbanStatusDots();
}

/**
 * Wire up the persistent add-task input in the todo column
 */
function wireAddInput(board: Element): void {
  const input = board.querySelector('.kanban-add-input') as HTMLInputElement | null;
  if (!input || input.dataset.wired) return;
  input.dataset.wired = '1';

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const path = projectPath.value;
      if (!path) return;
      input.value = '';
      await window.api.task.create(path, name);
      invalidateTaskList();
      await populateKanbanBoard();
      // Re-wire and focus since populateKanbanBoard may recreate the input
      wireAddInput(board);
      const newInput = board.querySelector('.kanban-add-input') as HTMLInputElement | null;
      if (newInput) newInput.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      input.blur();
    }
  });
}

/**
 * Show a start command dialog before opening a terminal.
 * Returns { command: string } to run a command, 'skip' to open terminal with no command, or null to cancel.
 */
async function showStartCommandDialog(path: string, taskName: string): Promise<{ command: string; sandboxed: boolean } | null> {
  // Fetch start hook command and lima status before opening the dialog
  let startCommand = '';
  let limaAvailable = false;
  try {
    const [hooks, limaStatus] = await Promise.all([
      window.api.hooks.get(path),
      window.api.lima.status(path).then(s => s.available).catch(() => false),
    ]);
    if (hooks.start?.command) startCommand = hooks.start.command;
    limaAvailable = limaStatus;
  } catch { /* no hook configured */ }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: { command: string; sandboxed: boolean } | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

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

    // Sandbox toggle (only if lima is available)
    let sandboxed = false;
    let toggleRow: HTMLDivElement | undefined;
    if (limaAvailable) {
      toggleRow = document.createElement('div');
      toggleRow.className = 'task-form-sandbox-toggle';
      toggleRow.setAttribute('style', '-webkit-app-region: no-drag;');

      const toggle = document.createElement('div');
      toggle.className = 'sandbox-toggle';
      toggle.appendChild(document.createElement('div')).className = 'sandbox-toggle-knob';

      const label = document.createElement('span');
      label.className = 'task-form-sandbox-label';
      label.textContent = 'Sandbox';

      toggleRow.addEventListener('click', () => {
        sandboxed = !sandboxed;
        toggle.classList.toggle('sandbox-toggle--active', sandboxed);
      });

      toggleRow.appendChild(toggle);
      toggleRow.appendChild(label);
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'import-actions';
    actions.style.justifyContent = 'space-between';

    if (limaAvailable) {
      actions.appendChild(toggleRow!);
    } else {
      // Push buttons to the right when no toggle
      const spacer = document.createElement('div');
      actions.appendChild(spacer);
    }

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display: flex; gap: 8px;';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-secondary';
    skipBtn.textContent = 'Skip';
    skipBtn.setAttribute('style', '-webkit-app-region: no-drag;');
    skipBtn.addEventListener('click', () => finish({ command: '', sandboxed }));
    btnGroup.appendChild(skipBtn);

    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-primary';
    runBtn.textContent = 'Run';
    runBtn.setAttribute('style', '-webkit-app-region: no-drag;');
    runBtn.addEventListener('click', () => {
      const cmd = textarea.value.trim();
      finish({ command: cmd, sandboxed });
    });
    btnGroup.appendChild(runBtn);
    actions.appendChild(btnGroup);

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

    const matchingTerminals = terminalList.filter(t => t.taskId === taskNumber);
    let stack = header.querySelector('.kanban-card-status-dots') as HTMLElement | null;

    if (matchingTerminals.length > 0) {
      if (!stack) {
        stack = document.createElement('span');
        stack.className = 'kanban-card-status-dots';
        header.insertBefore(stack, header.firstChild);
      }
      // Rebuild dots to match current terminal list
      stack.innerHTML = '';
      for (const term of matchingTerminals) {
        const dot = document.createElement('span');
        dot.className = 'kanban-card-status-dot';
        dot.setAttribute('data-status', term.summaryType);
        const isSandboxed = term.container.querySelector('.theatre-card-status-dot--sandboxed') !== null;
        dot.classList.toggle('kanban-card-status-dot--sandboxed', isSandboxed);
        stack.appendChild(dot);
      }
    } else if (stack) {
      stack.remove();
    }
  });
}

/**
 * Show the kanban board
 */
export async function showKanbanBoard(): Promise<void> {
  if (kanbanVisible.value) return;
  kanbanVisible.value = true;

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

  // Wire up persistent add input in the todo column
  wireAddInput(board);

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

  // Create scroll shadow overlays
  const columns = board.querySelector('.kanban-columns') as HTMLElement;
  const leftShadow = document.createElement('div');
  leftShadow.className = 'kanban-scroll-shadow kanban-scroll-shadow--left';
  const rightShadow = document.createElement('div');
  rightShadow.className = 'kanban-scroll-shadow kanban-scroll-shadow--right';
  board.appendChild(leftShadow);
  board.appendChild(rightShadow);

  const SHADOW_FADE_DISTANCE = 80;
  const updateOverflowShadow = () => {
    if (!columns) return;
    const maxScroll = columns.scrollWidth - columns.clientWidth;
    if (maxScroll <= 0) {
      leftShadow.style.opacity = '0';
      rightShadow.style.opacity = '0';
      return;
    }
    leftShadow.style.opacity = String(Math.min(columns.scrollLeft / SHADOW_FADE_DISTANCE, 1));
    rightShadow.style.opacity = String(Math.min((maxScroll - columns.scrollLeft) / SHADOW_FADE_DISTANCE, 1));
  };
  if (columns) {
    columns.addEventListener('scroll', updateOverflowShadow);
  }
  const resizeObserver = new ResizeObserver(updateOverflowShadow);
  resizeObserver.observe(board);

  // Animate in
  requestAnimationFrame(() => {
    board.classList.add('kanban-board--visible');
    updateOverflowShadow();
  });

  // Push scope and register hotkeys
  pushScope(Scopes.KANBAN);

  registerHotkey('escape', Scopes.KANBAN, () => {
    hideKanbanBoard();
  });

  registerHotkey(platformHotkey('mod+b'), Scopes.KANBAN, () => {
    hideKanbanBoard();
  });

  registerHotkey(platformHotkey('mod+t'), Scopes.KANBAN, () => {
    hideKanbanBoard();
  });

  registerHotkey(platformHotkey('mod+n'), Scopes.KANBAN, () => {
    const input = document.querySelector('.kanban-add-input') as HTMLInputElement | null;
    if (input) input.focus();
  });

  theatreState.kanbanCleanup = () => {
    resizeObserver.disconnect();
    unregisterHotkey('escape', Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+b'), Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+t'), Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+n'), Scopes.KANBAN);
    popScope();
  };

  // Sync view toggle in header
  syncViewToggle();
}

/**
 * Hide the kanban board
 */
export function hideKanbanBoard(): void {
  if (!kanbanVisible.value) return;

  const board = document.querySelector('.kanban-board');
  if (board) {
    board.remove();
  }

  document.body.classList.remove('kanban-open');

  if (theatreState.kanbanCleanup) {
    theatreState.kanbanCleanup();
    theatreState.kanbanCleanup = null;
  }

  kanbanVisible.value = false;

  // Sync view toggle in header
  syncViewToggle();
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

/**
 * Show the kanban board and focus the new task input
 */
export async function showKanbanAndFocusInput(): Promise<void> {
  await showKanbanBoard();
  const input = document.querySelector('.kanban-add-input') as HTMLInputElement | null;
  if (input) input.focus();
}

// Register in the theatre registry for cross-module access
theatreRegistry.showKanbanAndFocusInput = showKanbanAndFocusInput;
theatreRegistry.toggleKanbanBoard = toggleKanbanBoard;
theatreRegistry.syncKanbanStatusDots = syncKanbanStatusDots;
