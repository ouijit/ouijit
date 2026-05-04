import { create } from 'zustand';
import type { TaskWithWorkspace, Script, ScriptHook, HookType } from '../types';
import type { RunHookResult } from '../components/dialogs/RunHookDialog';

export type TerminalLayout = 'stack' | 'canvas';

export interface RunHookRequest {
  id: number;
  projectPath: string;
  hookType: HookType;
  hook: ScriptHook;
  task: TaskWithWorkspace;
  resolve: (result: RunHookResult | null) => void;
}

interface ProjectStoreState {
  tasks: TaskWithWorkspace[];
  kanbanVisible: boolean;
  terminalLayout: TerminalLayout;
  activePanel: 'terminals' | 'settings';
  scripts: Script[];
  taskVersion: number;
  highlightedChainTask: number | null;
  detachHoverParent: number | null;
  optionKeyHeld: boolean;
  activeBadgeDrag: number | null;
  badgeDragOverTask: number | null;
  activeModal: string | null;
  selectedTaskNumbers: Set<number>;
  selectionAnchor: number | null;
  toasts: Array<{
    id: string;
    message: string;
    type: 'info' | 'error' | 'success';
    persistent?: boolean;
    actionLabel?: string;
    onAction?: () => void;
  }>;
  /** Tasks whose worktree creation is currently in flight. View-independent. */
  startingTaskNumbers: Set<number>;
  /** Active hook prompt; rendered globally so it survives view switches. */
  runHookRequest: RunHookRequest | null;
  _version: number;
}

interface ProjectStoreActions {
  setTasks: (tasks: TaskWithWorkspace[]) => void;
  invalidateTaskList: () => void;
  setKanbanVisible: (visible: boolean) => void;
  toggleKanban: () => void;
  showModal: (modal: string) => void;
  hideModal: () => void;
  addToast: (
    message: string,
    typeOrOptions?:
      | ('info' | 'error' | 'success')
      | {
          type?: 'info' | 'error' | 'success';
          persistent?: boolean;
          actionLabel?: string;
          onAction?: () => void;
        },
  ) => void;
  removeToast: (id: string) => void;
  setHighlightedChainTask: (taskNumber: number | null) => void;
  setDetachHoverParent: (taskNumber: number | null) => void;
  setActiveBadgeDrag: (taskNumber: number | null) => void;
  setBadgeDragOverTask: (taskNumber: number | null) => void;
  clearChainHighlights: () => void;
  resetBadgeDragState: () => void;
  setTerminalLayout: (layout: TerminalLayout) => void;
  toggleTerminalLayout: () => void;
  setActivePanel: (panel: 'terminals' | 'settings') => void;
  resetForProject: () => void;

  /** Toggle a single task's selection (Cmd/Ctrl+click) */
  toggleTaskSelection: (taskNumber: number) => void;
  /** Select a range of tasks from anchor to target (Shift+click) */
  selectTaskRange: (taskNumber: number, orderedTaskNumbers: number[]) => void;
  /** Clear all selection */
  clearSelection: () => void;

  /** Load tasks from IPC with staleness check */
  loadTasks: (projectPath: string) => Promise<void>;
  /** Load scripts from IPC */
  loadScripts: (projectPath: string) => Promise<void>;
  /** Move a task with optimistic update and rollback */
  moveTask: (projectPath: string, taskNumber: number, newStatus: string, targetIndex: number) => Promise<void>;

  /** Mark a task as starting (worktree being created). Does not depend on any view being mounted. */
  markTaskStarting: (taskNumber: number) => void;
  markTaskStartingDone: (taskNumber: number) => void;

  /** Open a hook-prompt dialog and return a promise that resolves with the user's choice. */
  requestRunHook: (req: Omit<RunHookRequest, 'id' | 'resolve'>) => Promise<RunHookResult | null>;
  /** Resolve the active hook prompt with a result (or null for cancel). */
  resolveRunHookRequest: (id: number, result: RunHookResult | null) => void;
}

type ProjectStore = ProjectStoreState & ProjectStoreActions;

let toastCounter = 0;
let moveCounter = 0;
let runHookRequestCounter = 0;

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  tasks: [],
  kanbanVisible: false,
  terminalLayout: 'stack',
  activePanel: 'terminals',
  scripts: [],
  taskVersion: 0,
  highlightedChainTask: null,
  detachHoverParent: null,
  optionKeyHeld: false,
  activeBadgeDrag: null,
  badgeDragOverTask: null,
  activeModal: null,
  selectedTaskNumbers: new Set<number>(),
  selectionAnchor: null,
  toasts: [],
  startingTaskNumbers: new Set<number>(),
  runHookRequest: null,
  _version: 0,

  setTasks: (tasks) => {
    const { selectedTaskNumbers } = get();
    if (selectedTaskNumbers.size > 0) {
      const validNumbers = new Set(tasks.map((t) => t.taskNumber));
      const pruned = new Set([...selectedTaskNumbers].filter((n) => validNumbers.has(n)));
      if (pruned.size !== selectedTaskNumbers.size) {
        set({ tasks, selectedTaskNumbers: pruned, selectionAnchor: pruned.size > 0 ? get().selectionAnchor : null });
        return;
      }
    }
    set({ tasks });
  },

  invalidateTaskList: () => set((s) => ({ taskVersion: s.taskVersion + 1 })),

  setKanbanVisible: (visible) => set({ kanbanVisible: visible }),

  toggleKanban: () => set((s) => ({ kanbanVisible: !s.kanbanVisible })),

  setHighlightedChainTask: (taskNumber) => {
    if (get().highlightedChainTask !== taskNumber) set({ highlightedChainTask: taskNumber });
  },

  setDetachHoverParent: (taskNumber) => {
    if (get().detachHoverParent !== taskNumber) set({ detachHoverParent: taskNumber });
  },

  setActiveBadgeDrag: (taskNumber) => {
    if (get().activeBadgeDrag !== taskNumber) set({ activeBadgeDrag: taskNumber });
  },

  setBadgeDragOverTask: (taskNumber) => {
    if (get().badgeDragOverTask !== taskNumber) set({ badgeDragOverTask: taskNumber });
  },

  clearChainHighlights: () => set({ highlightedChainTask: null, detachHoverParent: null }),

  resetBadgeDragState: () =>
    set({ activeBadgeDrag: null, badgeDragOverTask: null, highlightedChainTask: null, detachHoverParent: null }),

  setTerminalLayout: (layout) => set({ terminalLayout: layout }),

  toggleTerminalLayout: () => set((s) => ({ terminalLayout: s.terminalLayout === 'stack' ? 'canvas' : 'stack' })),

  setActivePanel: (panel) => set({ activePanel: panel }),

  showModal: (modal) => set({ activeModal: modal }),

  hideModal: () => set({ activeModal: null }),

  addToast: (message, typeOrOptions = 'info') => {
    const id = `toast-${++toastCounter}`;
    const opts = typeof typeOrOptions === 'string' ? { type: typeOrOptions } : typeOrOptions;
    const type = opts.type ?? 'info';
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id, message, type, persistent: opts.persistent, actionLabel: opts.actionLabel, onAction: opts.onAction },
      ],
    }));
    if (!opts.persistent) {
      setTimeout(() => get().removeToast(id), 4000);
    }
  },

  removeToast: (id) => {
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    }));
  },

  resetForProject: () => {
    // Unblock any service awaiting a hook prompt before we drop the request.
    const pending = get().runHookRequest;
    if (pending) pending.resolve(null);
    set({
      tasks: [],
      kanbanVisible: false,
      terminalLayout: 'stack',
      activePanel: 'terminals',
      scripts: [],
      taskVersion: 0,
      highlightedChainTask: null,
      detachHoverParent: null,
      optionKeyHeld: false,
      activeBadgeDrag: null,
      badgeDragOverTask: null,
      activeModal: null,
      selectedTaskNumbers: new Set<number>(),
      selectionAnchor: null,
      startingTaskNumbers: new Set<number>(),
      runHookRequest: null,
      _version: 0,
    });
  },

  toggleTaskSelection: (taskNumber) => {
    const prev = get().selectedTaskNumbers;
    const next = new Set(prev);
    if (next.has(taskNumber)) {
      next.delete(taskNumber);
    } else {
      next.add(taskNumber);
    }
    set({ selectedTaskNumbers: next, selectionAnchor: taskNumber });
  },

  selectTaskRange: (taskNumber, orderedTaskNumbers) => {
    const { selectionAnchor } = get();
    if (selectionAnchor == null) {
      // No anchor — treat as toggle
      const next = new Set(get().selectedTaskNumbers);
      next.add(taskNumber);
      set({ selectedTaskNumbers: next, selectionAnchor: taskNumber });
      return;
    }
    const anchorIdx = orderedTaskNumbers.indexOf(selectionAnchor);
    const targetIdx = orderedTaskNumbers.indexOf(taskNumber);
    if (anchorIdx === -1 || targetIdx === -1) return;
    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    const rangeNumbers = orderedTaskNumbers.slice(start, end + 1);
    const next = new Set([...get().selectedTaskNumbers, ...rangeNumbers]);
    set({ selectedTaskNumbers: next });
  },

  clearSelection: () => {
    set({ selectedTaskNumbers: new Set<number>(), selectionAnchor: null });
  },

  loadTasks: async (projectPath) => {
    const version = ++get()._version;
    try {
      const tasks = await window.api.task.getAll(projectPath);
      if (get()._version !== version) return;
      set({ tasks });
    } catch (err) {
      if (get()._version !== version) return;
      get().addToast(`Failed to load tasks: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  },

  loadScripts: async (projectPath) => {
    try {
      const scripts = await window.api.scripts.getAll(projectPath);
      set({ scripts });
    } catch (err) {
      get().addToast(`Failed to load scripts: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  },

  moveTask: async (projectPath, taskNumber, newStatus, targetIndex) => {
    const prev = get().tasks;
    const moveVersion = ++moveCounter;
    // Optimistic: reorder locally
    const task = prev.find((t) => t.taskNumber === taskNumber);
    if (!task) return;
    const updated = prev.filter((t) => t.taskNumber !== taskNumber);
    const updatedTask = { ...task, status: newStatus as TaskWithWorkspace['status'] };
    // Insert at target position within the status group
    const statusTasks = updated.filter((t) => t.status === newStatus);
    const otherTasks = updated.filter((t) => t.status !== newStatus);
    statusTasks.splice(targetIndex, 0, updatedTask);
    // Update order field so the kanban sort reflects the new positions
    const orderedStatusTasks = statusTasks.map((t, i) => ({ ...t, order: i }));
    set({ tasks: [...otherTasks, ...orderedStatusTasks] });

    const rollbackOrReload = () => {
      // Only rollback if no other move has happened since our snapshot
      if (moveCounter === moveVersion) {
        set({ tasks: prev });
      } else {
        get().loadTasks(projectPath);
      }
      get().addToast('Failed to move task', 'error');
    };

    try {
      const result = await window.api.task.reorder(projectPath, taskNumber, newStatus as any, targetIndex);
      if (!result.success) {
        rollbackOrReload();
      } else if (moveCounter !== moveVersion) {
        // Another move happened while this one was in flight — reconcile with server
        get().loadTasks(projectPath);
      }
    } catch {
      rollbackOrReload();
    }
  },

  markTaskStarting: (taskNumber) => {
    const next = new Set(get().startingTaskNumbers);
    if (next.has(taskNumber)) return;
    next.add(taskNumber);
    set({ startingTaskNumbers: next });
  },

  markTaskStartingDone: (taskNumber) => {
    const prev = get().startingTaskNumbers;
    if (!prev.has(taskNumber)) return;
    const next = new Set(prev);
    next.delete(taskNumber);
    set({ startingTaskNumbers: next });
  },

  requestRunHook: (req) =>
    new Promise<RunHookResult | null>((resolve) => {
      // If a prior prompt is still open (rare race: two transitions in flight),
      // resolve it to null so the previous service call doesn't hang forever.
      const prior = get().runHookRequest;
      if (prior) prior.resolve(null);
      const id = ++runHookRequestCounter;
      set({ runHookRequest: { ...req, id, resolve } });
    }),

  resolveRunHookRequest: (id, result) => {
    const current = get().runHookRequest;
    if (!current || current.id !== id) return;
    set({ runHookRequest: null });
    current.resolve(result);
  },
}));
