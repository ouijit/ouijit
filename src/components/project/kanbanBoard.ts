/**
 * Kanban board view — spatial task management with drag-and-drop
 */

import type { TaskWithWorkspace, TaskStatus, RunConfig, HookType } from '../../types';
import type { ProjectTerminal } from './state';
import { projectState } from './state';
import { projectPath, kanbanVisible, terminals, activeIndex, invalidateTaskList } from './signals';
import { projectRegistry } from './helpers';
import { showToast } from '../importDialog';
import { showHookConfigDialog, showCombinedHookConfigDialog } from '../hookConfigDialog';
import { reopenTask, deleteTask, closeTask, showMissingWorktreeDialog } from './worktreeDropdown';
import { switchToProjectTerminal } from './terminalCards';
import { escapeHtml, setupHighlightedTextarea } from '../../utils/html';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes, platformHotkey } from '../../utils/hotkeys';
import { createIcons, icons } from 'lucide';
import Sortable from 'sortablejs';
import log from 'electron-log/renderer';

const kanbanLog = log.scope('kanban');

/**
 * Sync the view toggle buttons' active state with kanban visibility
 */
export function syncViewToggle(): void {
  const btns = document.querySelectorAll('.project-view-toggle-btn');
  btns.forEach(btn => {
    const view = (btn as HTMLElement).dataset.view;
    const isBoard = view === 'board';
    btn.classList.toggle('project-view-toggle-btn--active', isBoard === kanbanVisible.value);
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
  connectedTerminals: { terminal: ProjectTerminal; index: number }[],
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
      dot.classList.toggle('kanban-card-status-dot--sandboxed', terminal.sandboxed);
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

/** Map columns to their associated lifecycle hooks */
const COLUMN_HOOKS: Partial<Record<TaskStatus, { hooks: HookType[]; tooltip: string }>> = {
  in_progress: { hooks: ['start', 'continue'], tooltip: 'Configure start/continue hooks' },
  in_review: { hooks: ['review'], tooltip: 'Configure review hook' },
  done: { hooks: ['cleanup'], tooltip: 'Configure done hook' },
};

/**
 * Build the kanban board HTML shell
 */
function buildKanbanHtml(): string {
  const columnsHtml = KANBAN_COLUMNS.map(col => {
    const hookInfo = COLUMN_HOOKS[col.status];
    const hookBtn = hookInfo
      ? `<button class="kanban-column-hook-btn" data-hook-column="${col.status}" title="${hookInfo.tooltip}" style="-webkit-app-region: no-drag;"><i data-lucide="fishing-hook"></i></button>`
      : '';
    return `
      <div class="kanban-column" data-status="${col.status}">
        <div class="kanban-column-header">
          <span class="kanban-column-title">${col.label} <span class="kanban-column-count">0</span></span>
          ${hookBtn}
        </div>
        <div class="kanban-column-body">
          ${col.status === 'todo' ? '<input type="text" class="kanban-add-input" placeholder="New task..." style="-webkit-app-region: no-drag;" />' : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="kanban-board">
      <div class="kanban-columns">${columnsHtml}</div>
    </div>
  `;
}

/**
 * Check if a task's worktree exists, and if not, prompt the user to recover it.
 * Returns the (possibly new) worktree path on success, or null if the user cancelled or recovery failed.
 */
async function ensureWorktreeExists(path: string, task: TaskWithWorkspace): Promise<string | null> {
  if (!task.worktreePath) return null;
  const check = await window.api.task.checkWorktree(path, task.taskNumber);
  if (check.exists) return task.worktreePath;

  kanbanLog.warn('worktree missing', { taskNumber: task.taskNumber, branchExists: check.branchExists });
  const action = await showMissingWorktreeDialog(task, check.branchExists);
  if (action !== 'recover') {
    kanbanLog.info('user cancelled worktree recovery', { taskNumber: task.taskNumber });
    return null;
  }

  const result = await window.api.task.recover(path, task.taskNumber);
  if (!result.success || !result.worktreePath) {
    kanbanLog.error('worktree recovery failed', { taskNumber: task.taskNumber, error: result.error });
    showToast(result.error || 'Failed to recover worktree', 'error');
    return null;
  }

  kanbanLog.info('worktree recovered', { taskNumber: task.taskNumber, worktreePath: result.worktreePath });
  // Update the local task object with new data
  task.worktreePath = result.worktreePath;
  if (result.task?.branch) task.branch = result.task.branch;
  invalidateTaskList();
  return result.worktreePath;
}

/**
 * Toggle loading state on a kanban card (dims card, disables interaction, shows spinner).
 * No explicit cleanup needed — populateKanbanBoard() rebuilds all cards from scratch.
 */
export function setCardLoading(taskNumber: number, loading: boolean): void {
  const card = document.querySelector(`.kanban-card[data-task-number="${taskNumber}"]`) as HTMLElement | null;
  if (!card) return;

  if (loading) {
    card.classList.add('kanban-card--loading');
    const header = card.querySelector('.kanban-card-header');
    if (header && !header.querySelector('.kanban-card-loading-spinner')) {
      const spinner = document.createElement('div');
      spinner.className = 'kanban-card-loading-spinner';
      header.appendChild(spinner);
    }
  } else {
    card.classList.remove('kanban-card--loading');
    card.querySelector('.kanban-card-loading-spinner')?.remove();
  }
}

/**
 * Build a kanban card DOM element for a task
 */
function buildKanbanCard(task: TaskWithWorkspace, path: string, limaAvailable: boolean, editorConfigured: boolean): HTMLElement {
  if (task.taskNumber == null) {
    kanbanLog.error('task with missing taskNumber', { task });
  }
  const card = document.createElement('div');
  card.className = 'kanban-card' + (task.status === 'done' ? ' kanban-card--done' : '');
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

  // Description row — always visible, with placeholder when empty
  const promptRow = document.createElement('div');
  promptRow.className = 'kanban-card-detail-row';

  const promptValue = document.createElement('span');
  promptValue.contentEditable = 'true';
  promptValue.className = 'kanban-card-detail-value kanban-card-detail-value--editing' + (!task.prompt ? ' kanban-card-detail-value--placeholder' : '');
  promptValue.textContent = task.prompt || 'Add description...';
  promptValue.setAttribute('style', '-webkit-app-region: no-drag;');
  promptRow.appendChild(promptValue);

  // Clear placeholder on focus, restore on blur if empty
  promptValue.addEventListener('focus', () => {
    if (!task.prompt) {
      promptValue.textContent = '';
      promptValue.classList.remove('kanban-card-detail-value--placeholder');
    }
  });

  promptValue.addEventListener('blur', async () => {
    const newDesc = (promptValue.textContent || '').trim();
    if (newDesc !== (task.prompt || '')) {
      const result = await window.api.task.setDescription(path, task.taskNumber, newDesc);
      if (result.success) {
        task.prompt = newDesc || undefined;
        invalidateTaskList();
      }
    }
    if (!task.prompt) {
      promptValue.textContent = 'Add description...';
      promptValue.classList.add('kanban-card-detail-value--placeholder');
    }
  });

  promptValue.addEventListener('keydown', (ke) => {
    ke.stopPropagation();
    if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); promptValue.blur(); }
    if (ke.key === 'Escape') { ke.preventDefault(); promptValue.blur(); }
  });

  promptValue.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  detail.appendChild(promptRow);

  if (task.branch) {
    const branchRow = document.createElement('div');
    branchRow.className = 'kanban-card-branch';
    branchRow.innerHTML = `<i data-lucide="git-branch"></i><span class="kanban-card-branch-name">${escapeHtml(task.branch)}</span>`;
    detail.appendChild(branchRow);
  }

  const date = new Date(task.createdAt);
  const dateRow = document.createElement('div');
  dateRow.className = 'kanban-card-branch';
  dateRow.textContent = `Created ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  detail.appendChild(dateRow);

  card.appendChild(detail);

  // Click anywhere on card toggles expand/collapse
  let clickTimer: ReturnType<typeof setTimeout>;

  const toggleExpand = () => {
    const isExpanded = detail.classList.toggle('kanban-card-detail--visible');
    expandBtn.classList.toggle('kanban-card-expand--open', isExpanded);
    card.classList.toggle('kanban-card--expanded', isExpanded);
  };

  header.addEventListener('click', (e) => {
    clearTimeout(clickTimer);
    const target = e.target as HTMLElement;
    if (target.closest('.kanban-card-name')) {
      clickTimer = setTimeout(() => toggleExpand(), 200);
    } else {
      toggleExpand();
    }
  });

  header.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
  });

  // Right-click context menu
  card.addEventListener('contextmenu', (e) => {
    const connectedTerminals = terminals.value
      .map((t, i) => ({ terminal: t, index: i }))
      .filter(({ terminal: t }) => t.taskId === task.taskNumber);

    const onOpenTerminal = async () => {
      kanbanLog.info('openTerminal', { taskNumber: task.taskNumber, status: task.status, hasWorktree: !!task.worktreePath });
      if (task.status === 'done') {
        if (task.worktreePath) {
          const wtPath = await ensureWorktreeExists(path, task);
          if (!wtPath) return;
        }
        hideKanbanBoard();
        await reopenTask(path, task);
        return;
      }
      if (!task.worktreePath) {
        setCardLoading(task.taskNumber, true);
        const startResult = await window.api.task.start(path, task.taskNumber);
        if (!startResult.success || !startResult.worktreePath) {
          kanbanLog.error('task.start failed', { taskNumber: task.taskNumber, error: startResult.error });
          return;
        }
        await window.api.task.setStatus(path, task.taskNumber, 'in_progress');
        invalidateTaskList();
        hideKanbanBoard();
        await projectRegistry.addProjectTerminal?.(undefined, {
          existingWorktree: {
            path: startResult.worktreePath,
            branch: startResult.task?.branch || '',
            prompt: task.prompt,
            createdAt: task.createdAt,
            sandboxed: task.sandboxed,
          },
          taskId: task.taskNumber,
          sandboxed: false,
          skipAutoHook: true,
        });
        return;
      }
      const worktreePath = await ensureWorktreeExists(path, task);
      if (!worktreePath) return;

      hideKanbanBoard();
      await projectRegistry.addProjectTerminal?.(undefined, {
        existingWorktree: {
          path: worktreePath,
          branch: task.branch || '',
          prompt: task.prompt,
          createdAt: task.createdAt,
          sandboxed: task.sandboxed,
        },
        taskId: task.taskNumber,
        sandboxed: false,
        skipAutoHook: true,
      });
    };

    const onSandbox = limaAvailable ? async () => {
      if (task.status === 'done') {
        if (task.worktreePath) {
          const wtPath = await ensureWorktreeExists(path, task);
          if (!wtPath) return;
        }
        const worktreeOpts = {
          path: task.worktreePath!,
          branch: task.branch || '',
          prompt: task.prompt,
          createdAt: task.createdAt,
          sandboxed: task.sandboxed,
        };
        const result = await window.api.task.setStatus(path, task.taskNumber, 'in_progress');
        if (result.success) {
          invalidateTaskList();
          hideKanbanBoard();
          await projectRegistry.addProjectTerminal?.(undefined, {
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
        await projectRegistry.addProjectTerminal?.(undefined, {
          existingWorktree: {
            path: startResult.worktreePath,
            branch: startResult.task?.branch || '',
            prompt: task.prompt,
            createdAt: task.createdAt,
            sandboxed: task.sandboxed,
          },
          taskId: task.taskNumber,
          sandboxed: true,
        });
      } else {
        const worktreePath = await ensureWorktreeExists(path, task);
        if (!worktreePath) return;
        hideKanbanBoard();
        await projectRegistry.addProjectTerminal?.(undefined, {
          existingWorktree: {
            path: worktreePath,
            branch: task.branch || '',
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
        switchToProjectTerminal(idx);
      }
    };

    const onCloseOrReopen = async () => {
      if (task.status === 'done') {
        if (task.worktreePath) {
          const wtPath = await ensureWorktreeExists(path, task);
          if (!wtPath) return;
        }
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
 * Toggle .is-scrolling on kanban column bodies during scroll,
 * so CSS can show the scrollbar thumb only while actively scrolling.
 */
function setupColumnScrollIndicators(): void {
  const bodies = document.querySelectorAll('.kanban-column-body');
  bodies.forEach(body => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    body.addEventListener('scroll', () => {
      body.classList.add('is-scrolling');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => body.classList.remove('is-scrolling'), 800);
    }, { passive: true });
  });
}

/**
 * Show the trash drop zone on the right edge of the kanban board during drag.
 */
let trashSortable: Sortable | null = null;
let trashZoneEl: HTMLElement | null = null;
let trashDragListener: ((e: DragEvent) => void) | null = null;

/**
 * Create the trash zone element (hidden) and append it to the kanban columns.
 * Called on drag start so it's in the DOM and ready to reveal.
 */
function initTrashZone(evt: Sortable.SortableEvent): void {
  const columns = document.querySelector('.kanban-columns');
  if (!columns || trashZoneEl) return;

  const zone = document.createElement('div');
  zone.className = 'kanban-trash-zone';
  zone.innerHTML = '<i data-lucide="trash-2"></i><span>Delete</span>';
  columns.appendChild(zone);
  trashZoneEl = zone;

  createIcons({ icons, nameAttr: 'data-lucide', attrs: {}, nodes: [zone] });

  trashSortable = Sortable.create(zone, {
    group: 'kanban',
    draggable: '.kanban-card',
    onAdd: (evt) => { handleTrashDrop(evt); },
  });

  // Track drag position — reveal when cursor reaches the Done column's left edge.
  // HTML5 DnD suppresses mousemove; dragover fires instead.
  const doneCol = columns.querySelector('.kanban-column[data-status="done"]') as HTMLElement | null;
  const threshold = doneCol ? doneCol.getBoundingClientRect().left : window.innerWidth * 0.75;

  trashDragListener = (e: DragEvent) => {
    if (!trashZoneEl || e.clientX === 0) return; // clientX 0 = synthetic/end event
    if (e.clientX >= threshold) {
      trashZoneEl.classList.add('kanban-trash-zone--visible');
    } else {
      trashZoneEl.classList.remove('kanban-trash-zone--visible');
    }
  };
  document.addEventListener('dragover', trashDragListener);

  // If dragging from the Done column, the cursor is already past the threshold
  const fromColumn = (evt.from as HTMLElement).closest('.kanban-column') as HTMLElement | null;
  if (fromColumn?.dataset.status === 'done') {
    requestAnimationFrame(() => zone.classList.add('kanban-trash-zone--visible'));
  }
}

function teardownTrashZone(): void {
  if (trashDragListener) {
    document.removeEventListener('dragover', trashDragListener);
    trashDragListener = null;
  }
  if (!trashZoneEl) return;
  const zone = trashZoneEl;
  zone.classList.remove('kanban-trash-zone--visible');
  if (trashSortable) {
    trashSortable.destroy();
    trashSortable = null;
  }
  setTimeout(() => zone.remove(), 200);
  trashZoneEl = null;
}

async function handleTrashDrop(evt: Sortable.SortableEvent): Promise<void> {
  const item = evt.item as HTMLElement;
  const taskNumber = parseInt(item.dataset.taskNumber || '', 10);
  if (isNaN(taskNumber)) return;

  item.remove();

  const path = projectPath.value;
  if (!path) return;

  // Close any open terminals for this task
  const currentTerminals = terminals.value;
  for (let i = currentTerminals.length - 1; i >= 0; i--) {
    if (currentTerminals[i].taskId === taskNumber) {
      projectRegistry.closeProjectTerminal?.(i);
    }
  }

  const result = await window.api.task.trash(path, taskNumber);
  if (result.success) {
    invalidateTaskList();
    showToast(result.trashed ? 'Task moved to trash' : 'Task deleted', 'success');
  } else {
    showToast(result.error || 'Failed to delete task', 'error');
  }

  await populateKanbanBoard();
}

/**
 * Set up SortableJS instances for each kanban column body.
 * Called after populateKanbanBoard rebuilds the DOM.
 */
function setupSortable(): void {
  const board = document.querySelector('.kanban-board');
  if (!board) return;

  const bodies = board.querySelectorAll('.kanban-column-body');
  bodies.forEach(body => {
    // Destroy any existing Sortable instance before creating a new one
    const existing = Sortable.get(body as HTMLElement);
    if (existing) existing.destroy();

    Sortable.create(body as HTMLElement, {
      group: 'kanban',
      animation: 150,
      draggable: '.kanban-card',
      ghostClass: 'kanban-card--ghost',
      filter: '.kanban-add-input, .kanban-card-name-input, .kanban-card-detail-value--editing',
      preventOnFilter: false,
      onStart: (evt) => { initTrashZone(evt); },
      onEnd: (evt) => { teardownTrashZone(); handleSortableEnd(evt); },
    });
  });
}

/**
 * Open a terminal based on a hook dialog result.
 * Run → background terminal with command, stay on kanban.
 * Run & Open → run command (if any) AND navigate to the terminal, hide kanban.
 */
async function openTerminalFromDialog(
  dialogResult: { command: string; sandboxed: boolean; foreground: boolean },
  hookName: string,
  existingWorktree: { path: string; branch: string; prompt?: string; createdAt?: string; sandboxed?: boolean },
  taskId: number,
): Promise<void> {
  const termOpts = {
    existingWorktree,
    taskId,
    sandboxed: dialogResult.sandboxed,
    skipAutoHook: true,
    background: !dialogResult.foreground,
  };

  if (dialogResult.foreground) hideKanbanBoard();

  if (dialogResult.command) {
    const runConfig: RunConfig = { name: hookName, command: dialogResult.command, source: 'custom', priority: 0 };
    await projectRegistry.addProjectTerminal?.(runConfig, termOpts);
  } else {
    await projectRegistry.addProjectTerminal?.(undefined, termOpts);
  }
}

/**
 * Check if a hook is configured and run it in a terminal.
 * Shows a command dialog so the user can run/open/cancel before opening.
 */
async function runTransitionHookInTerminal(
  path: string,
  task: TaskWithWorkspace,
  hookType: 'continue' | 'review' | 'cleanup',
): Promise<void> {
  const hooks = await window.api.hooks.get(path);
  const hookMap: Record<string, typeof hooks.review> = { continue: hooks.continue, review: hooks.review, cleanup: hooks.cleanup };
  if (!hookMap[hookType]) return; // no hook configured

  const dialogResult = await showStartCommandDialog(path, hookType, task);
  if (dialogResult === null) return; // cancelled

  await openTerminalFromDialog(dialogResult, hookType, {
    path: task.worktreePath!,
    branch: task.branch || '',
    createdAt: task.createdAt,
    sandboxed: task.sandboxed,
  }, task.taskNumber);
}

/**
 * Handle a SortableJS onEnd event — persist reorder and handle special status transitions.
 */
async function handleSortableEnd(evt: Sortable.SortableEvent): Promise<void> {
  // If the card was dropped on the trash zone, its onAdd handler takes care of deletion
  if ((evt.to as HTMLElement).closest('.kanban-trash-zone')) return;

  const item = evt.item as HTMLElement;
  const taskNumber = parseInt(item.dataset.taskNumber || '', 10);
  if (isNaN(taskNumber)) {
    kanbanLog.error('drag: no task number on dragged element', { tagName: item.tagName, className: item.className });
    return;
  }

  const toColumn = (evt.to as HTMLElement).closest('.kanban-column') as HTMLElement | null;
  const newStatus = toColumn?.dataset.status as TaskStatus | undefined;
  if (!newStatus) {
    kanbanLog.error('drag: could not determine target column', { taskNumber });
    return;
  }

  const path = projectPath.value;
  if (!path) {
    kanbanLog.error('drag: no project path', { taskNumber });
    return;
  }

  const targetIndex = evt.newIndex ?? 0;
  kanbanLog.info('drag', { taskNumber, newStatus, targetIndex });

  // Dropping a task into in_progress — create worktree if needed + show start command dialog
  if (newStatus === 'in_progress') {
    const tasks = await window.api.task.getAll(path);
    const task = tasks.find(t => t.taskNumber === taskNumber);

    if (task && task.status === 'todo') {
      let worktreePath = task.worktreePath;
      let branch = task.branch || '';

      if (worktreePath) {
        // Worktree recorded — verify it still exists on disk
        const verified = await ensureWorktreeExists(path, task);
        if (!verified) {
          await populateKanbanBoard();
          return;
        }
        worktreePath = verified;
        branch = task.branch || '';
      } else {
        // No worktree yet — create one
        setCardLoading(taskNumber, true);
        const startResult = await window.api.task.start(path, taskNumber);
        if (!startResult.success || !startResult.worktreePath) {
          await populateKanbanBoard();
          return;
        }
        worktreePath = startResult.worktreePath;
        branch = startResult.task?.branch || '';
      }

      // Use reorder to set status + position
      await window.api.task.reorder(path, taskNumber, 'in_progress', targetIndex);
      invalidateTaskList();

      // Show start command dialog only if a start hook is configured
      const hooks = await window.api.hooks.get(path);
      if (hooks.start) {
        const dialogResult = await showStartCommandDialog(path, 'start', { ...task, worktreePath, branch });
        if (dialogResult === null) {
          // User cancelled — task stays in_progress but no terminal opened
          await populateKanbanBoard();
          return;
        }

        await openTerminalFromDialog(dialogResult, 'start', {
          path: worktreePath,
          branch,
          prompt: task.prompt,
          createdAt: task.createdAt,
          sandboxed: task.sandboxed,
        }, taskNumber);
      } else {
        // No hook — just open a terminal in the worktree
        await projectRegistry.addProjectTerminal?.(undefined, {
          existingWorktree: {
            path: worktreePath,
            branch,
            createdAt: task.createdAt,
            prompt: task.prompt,
            sandboxed: task.sandboxed,
          },
          taskId: taskNumber,
          sandboxed: false,
          skipAutoHook: true,
        });
      }
      await populateKanbanBoard();
      return;
    }

    // Non-todo task dragged back to in_progress (e.g., from in_review/done)
    if (task && task.status !== 'todo' && task.worktreePath) {
      const verified = await ensureWorktreeExists(path, task);
      if (!verified) {
        await populateKanbanBoard();
        return;
      }
      await window.api.task.reorder(path, taskNumber, 'in_progress', targetIndex);
      invalidateTaskList();
      await populateKanbanBoard();
      await runTransitionHookInTerminal(path, task, 'continue');
      return;
    }
  }

  if (newStatus === 'done') {
    // Close any open terminals for this task
    const currentTerminals = terminals.value;
    for (let i = currentTerminals.length - 1; i >= 0; i--) {
      if (currentTerminals[i].taskId === taskNumber) {
        projectRegistry.closeProjectTerminal?.(i);
      }
    }
    await window.api.task.reorder(path, taskNumber, 'done', targetIndex);
    invalidateTaskList();
    await populateKanbanBoard();

    // Run cleanup hook in a terminal if configured
    const tasks = await window.api.task.getAll(path);
    const task = tasks.find(t => t.taskNumber === taskNumber);
    if (task?.worktreePath) {
      await runTransitionHookInTerminal(path, task, 'cleanup');
    }
    return;
  }

  if (newStatus === 'in_review') {
    await window.api.task.reorder(path, taskNumber, 'in_review', targetIndex);
    invalidateTaskList();
    await populateKanbanBoard();

    // Run review hook in a terminal if configured
    const tasks = await window.api.task.getAll(path);
    const task = tasks.find(t => t.taskNumber === taskNumber);
    if (task?.worktreePath) {
      await runTransitionHookInTerminal(path, task, 'review');
    }
    return;
  }

  const result = await window.api.task.reorder(path, taskNumber, newStatus, targetIndex);
  if (result.success) {
    invalidateTaskList();
    await populateKanbanBoard();
  } else {
    kanbanLog.error('reorder failed', { taskNumber, newStatus, error: result.error });
  }
}

/**
 * Update column hook icon active state based on configured hooks
 */
function updateColumnHookIcons(board: Element, hooks: Awaited<ReturnType<typeof window.api.hooks.get>>): void {
  const configured: Record<string, boolean> = {
    in_progress: !!hooks.start || !!hooks.continue,
    in_review: !!hooks.review,
    done: !!hooks.cleanup,
  };
  for (const [status, isActive] of Object.entries(configured)) {
    const btn = board.querySelector(`.kanban-column[data-status="${status}"] .kanban-column-hook-btn`);
    if (btn) btn.classList.toggle('kanban-column-hook-btn--active', isActive);
  }
}

/**
 * Re-fetch hooks and update all column hook icon colors
 */
async function refreshColumnHookIcons(): Promise<void> {
  const path = projectPath.value;
  if (!path) return;
  const board = document.querySelector('.kanban-board');
  if (!board) return;
  const hooks = await window.api.hooks.get(path).catch(() => ({} as Awaited<ReturnType<typeof window.api.hooks.get>>));
  updateColumnHookIcons(board, hooks);
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

  // Update column hook icon colors
  updateColumnHookIcons(board, hooks);

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
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

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

  // Set up SortableJS drag-and-drop on each column
  setupSortable();

  // Show scrollbar only while scrolling
  setupColumnScrollIndicators();
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
 * Returns { command, sandboxed, foreground } to run/open a terminal, or null to cancel.
 */
const HOOK_DIALOG_TITLES: Record<string, string> = {
  start: 'Start Task',
  continue: 'Continue Task',
  review: 'Review Task',
  cleanup: 'Done — Cleanup',
};

async function showStartCommandDialog(path: string, hookType: 'start' | 'continue' | 'review' | 'cleanup' = 'start', task?: TaskWithWorkspace): Promise<{ command: string; sandboxed: boolean; foreground: boolean } | null> {
  // Fetch hook command and lima status before opening the dialog
  let hookCommand = '';
  let limaAvailable = false;
  try {
    const [hooks, limaStatus] = await Promise.all([
      window.api.hooks.get(path),
      window.api.lima.status(path).then(s => s.available).catch(() => false),
    ]);
    const hookMap: Record<string, typeof hooks.start> = {
      start: hooks.start,
      continue: hooks.continue,
      review: hooks.review,
      cleanup: hooks.cleanup,
    };
    const hook = hookMap[hookType];
    if (hook?.command) hookCommand = hook.command;
    limaAvailable = limaStatus;
  } catch { /* no hook configured */ }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: { command: string; sandboxed: boolean; foreground: boolean } | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Build overlay + dialog
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';

    const title = document.createElement('div');
    title.className = 'dialog-title';
    title.textContent = HOOK_DIALOG_TITLES[hookType] || 'Run Command';
    dialog.appendChild(title);

    // Textarea for the command
    const textarea = document.createElement('textarea');
    textarea.className = 'form-input form-textarea start-command-textarea';
    textarea.value = hookCommand;
    textarea.placeholder = 'e.g. npm run dev';
    textarea.rows = 1;
    textarea.setAttribute('style', '-webkit-app-region: no-drag;');
    dialog.appendChild(textarea);
    const envVarValues = task ? {
      '$OUIJIT_TASK_NAME': task.name || undefined,
      '$OUIJIT_PROJECT_PATH': path || undefined,
      '$OUIJIT_WORKTREE_PATH': task.worktreePath || undefined,
      '$OUIJIT_BRANCH': task.branch || undefined,
    } : undefined;
    setupHighlightedTextarea(textarea, 240, envVarValues);

    // Environment variables hint
    const envVars = ['$OUIJIT_TASK_NAME', '$OUIJIT_PROJECT_PATH', '$OUIJIT_WORKTREE_PATH', '$OUIJIT_BRANCH'];
    const envHint = document.createElement('details');
    envHint.className = 'hook-env-vars';
    envHint.setAttribute('style', '-webkit-app-region: no-drag;');
    envHint.innerHTML = `<summary>Available environment variables</summary><ul>${envVars.map(v => `<li><code class="hook-env-var" data-var="${v}">${v}</code></li>`).join('')}</ul>`;
    envHint.querySelectorAll('.hook-env-var').forEach(code => {
      code.addEventListener('click', () => {
        const varName = (code as HTMLElement).dataset.var!;
        navigator.clipboard.writeText(varName);
        code.classList.add('hook-env-var--copied');
        const original = code.textContent;
        code.textContent = 'Copied!';
        setTimeout(() => {
          code.textContent = original;
          code.classList.remove('hook-env-var--copied');
        }, 800);
      });
    });
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
    actions.className = 'dialog-actions';
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

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('style', '-webkit-app-region: no-drag;');
    cancelBtn.addEventListener('click', () => finish(null));
    btnGroup.appendChild(cancelBtn);

    const runOpenBtn = document.createElement('button');
    runOpenBtn.className = 'btn btn-primary';
    runOpenBtn.textContent = 'Run & Open';
    runOpenBtn.setAttribute('style', '-webkit-app-region: no-drag; white-space: nowrap;');
    runOpenBtn.addEventListener('click', () => finish({ command: textarea.value.trim(), sandboxed, foreground: true }));
    btnGroup.appendChild(runOpenBtn);

    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-primary';
    runBtn.textContent = 'Run';
    runBtn.setAttribute('style', '-webkit-app-region: no-drag;');
    runBtn.addEventListener('click', () => {
      const cmd = textarea.value.trim();
      finish({ command: cmd, sandboxed, foreground: false });
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
      dialog.classList.remove('dialog--visible');
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
      dialog.classList.add('dialog--visible');
      textarea.focus();
    });
  });
}

/**
 * Sync all kanban card status dots with current terminal state.
 * Creates, updates, or removes dots as needed.
 */
export function syncKanbanStatusDots(): void {
  // Remove any stray tooltips from previous dots
  document.querySelectorAll('.kanban-dot-tooltip').forEach(t => t.remove());

  const cards = document.querySelectorAll('.kanban-card[data-task-number]');
  const terminalList = terminals.value;
  cards.forEach(card => {
    const taskNumber = parseInt((card as HTMLElement).dataset.taskNumber || '', 10);
    if (isNaN(taskNumber)) return;

    const header = card.querySelector('.kanban-card-header');
    if (!header) return;

    const matchingTerminals = terminalList
      .map((t, i) => ({ terminal: t, index: i }))
      .filter(({ terminal: t }) => t.taskId === taskNumber);
    let stack = card.querySelector('.kanban-card-status-tree') as HTMLElement | null;

    if (matchingTerminals.length > 0) {
      if (!stack) {
        stack = document.createElement('div');
        stack.className = 'kanban-card-status-tree';
        // Insert after header, before any detail section
        header.after(stack);
      }
      // Rebuild tree rows
      stack.innerHTML = '';
      const total = matchingTerminals.length;
      for (let i = 0; i < total; i++) {
        const { terminal: term, index: termIndex } = matchingTerminals[i];
        const isLast = i === total - 1;

        // Build label text
        let label: string;
        if (term.lastOscTitle) {
          const cleaned = term.lastOscTitle.replace(/\p{Extended_Pictographic}/gu, '').trim();
          label = cleaned || 'Shell';
        } else if (term.command) {
          label = term.command;
        } else {
          label = 'Shell';
        }
        if (term.sandboxed) label += ' (sandbox)';
        if (term.summary) label += ' — ' + term.summary;

        const row = document.createElement('div');
        row.className = 'kanban-card-status-row';

        const elbow = document.createElement('span');
        elbow.className = 'kanban-card-status-elbow';
        elbow.textContent = isLast ? '└─' : '├─';
        row.appendChild(elbow);

        const dot = document.createElement('span');
        dot.className = 'kanban-card-status-dot';
        dot.setAttribute('data-status', term.summaryType);
        dot.classList.toggle('kanban-card-status-dot--sandboxed', term.sandboxed);
        row.appendChild(dot);

        const text = document.createElement('span');
        text.className = 'kanban-card-status-label';
        text.textContent = label.length > 35 ? label.slice(0, 35) + '…' : label;
        row.appendChild(text);

        row.addEventListener('click', (e) => {
          e.stopPropagation();
          hideKanbanBoard();
          if (termIndex !== activeIndex.value) {
            switchToProjectTerminal(termIndex);
          }
        });
        stack.appendChild(row);
      }
    } else if (stack) {
      stack.remove();
    }
  });
}

/**
 * Wire up click handlers for column header hook icons
 */
function setupColumnHookHandlers(board: Element): void {
  const path = projectPath.value;
  if (!path) return;

  const hookBtns = board.querySelectorAll('.kanban-column-hook-btn');
  for (const btn of hookBtns) {
    const column = (btn as HTMLElement).dataset.hookColumn as TaskStatus;
    const hookInfo = COLUMN_HOOKS[column];
    if (!hookInfo) continue;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();

      if (hookInfo.hooks.length > 1) {
        // In Progress: show combined start/continue dialog
        const hooks = await window.api.hooks.get(path);
        const result = await showCombinedHookConfigDialog(path, hooks.start, hooks.continue);
        if (result?.saved) {
          showToast('Hooks updated', 'success');
          await refreshColumnHookIcons();
        }
      } else {
        // In Review / Done: open dialog directly
        const hookType = hookInfo.hooks[0];
        const label = hookType === 'review' ? 'Review' : 'Done';
        const hooks = await window.api.hooks.get(path);
        const existing = hooks[hookType as keyof typeof hooks];
        const result = await showHookConfigDialog(path, hookType, existing);
        if (result?.saved) {
          showToast(`${label} hook ${result.hook ? 'updated' : 'removed'}`, 'success');
          await refreshColumnHookIcons();
        }
      }
    });
  }
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

  // Wire up column header hook icon click handlers
  setupColumnHookHandlers(board);

  // Populate with tasks (also sets up SortableJS)
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

  registerHotkey(platformHotkey('mod+i'), Scopes.KANBAN, () => {
    hideKanbanBoard();
    projectRegistry.addProjectTerminal?.();
  });

  projectState.kanbanCleanup = () => {
    resizeObserver.disconnect();
    unregisterHotkey('escape', Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+b'), Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+t'), Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+n'), Scopes.KANBAN);
    unregisterHotkey(platformHotkey('mod+i'), Scopes.KANBAN);
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

  if (projectState.kanbanCleanup) {
    projectState.kanbanCleanup();
    projectState.kanbanCleanup = null;
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

// Register in the project registry for cross-module access
projectRegistry.showKanbanAndFocusInput = showKanbanAndFocusInput;
projectRegistry.toggleKanbanBoard = toggleKanbanBoard;
projectRegistry.syncKanbanStatusDots = syncKanbanStatusDots;
