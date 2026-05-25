import { create } from 'zustand';
import type { TaskWithWorkspace, Script, ScriptHook, HookType, CliHookMode } from '../types';
import type { RunHookResult } from '../components/dialogs/RunHookDialog';
import { useAppStore } from './appStore';

export type TerminalLayout = 'stack' | 'canvas';

export interface RunHookRequest {
  id: number;
  projectPath: string;
  hookType: HookType;
  hook: ScriptHook;
  task: TaskWithWorkspace;
  resolve: (result: RunHookResult | null) => void;
}

export interface PendingCliStart {
  taskNumber: number;
  worktreePath: string;
  branch: string;
  createdAt: string;
  sandboxed: boolean;
  /** Hook-control mode from the CLI flags; absent = default start-hook dialog. */
  hookMode?: CliHookMode;
  /** Custom command when hookMode is 'command'. */
  hookCommand?: string;
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
  /**
   * FIFO queue of pending hook prompts. The head (`[0]`) is the one currently
   * shown; the rest wait their turn. Rendered globally so it survives view
   * switches. Concurrent task starts (CLI / multi-select drags) each append a
   * request rather than evicting the prior one.
   */
  runHookQueue: RunHookRequest[];
  /**
   * Count of hook prompts seen since the queue was last empty. Drives the
   * "Hook N of M" stepper — `M` stays fixed as the queue drains so the
   * position counts up instead of the total shrinking under the user.
   */
  runHookQueueTotal: number;
  /** Queued CLI-initiated task starts awaiting the user to enter the project. */
  pendingCliStarts: Record<string, PendingCliStart[]>;
  /**
   * Project-scoped config used by terminal/kanban cards. Loaded once per project
   * so we don't fan out N `lima.status` (subprocess spawn) + `hooks.get` calls
   * across every visible card.
   */
  sandboxAvailable: boolean;
  configuredHooks: Record<string, boolean>;
  /** projectPath the config currently reflects; null = not loaded. */
  configProjectPath: string | null;
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
  /**
   * Load project-scoped config (sandbox availability + configured hooks) in a
   * single pair of IPC calls. Replaces per-card fan-out where every kanban card
   * and terminal header spawned its own limactl subprocess on mount.
   */
  loadProjectConfig: (projectPath: string) => Promise<void>;
  /** Mark a hook as configured after the user saves one from a card dialog. */
  markHookConfigured: (hookType: HookType) => void;
  /** Move a task with optimistic update and rollback */
  moveTask: (projectPath: string, taskNumber: number, newStatus: string, targetIndex: number) => Promise<void>;

  /** Mark a task as starting (worktree being created). Does not depend on any view being mounted. */
  markTaskStarting: (taskNumber: number) => void;
  markTaskStartingDone: (taskNumber: number) => void;

  /** Enqueue a hook-prompt dialog and return a promise that resolves with the user's choice. */
  requestRunHook: (req: Omit<RunHookRequest, 'id' | 'resolve'>) => Promise<RunHookResult | null>;
  /** Resolve one queued hook prompt with a result (or null for skip/cancel). */
  resolveRunHookRequest: (id: number, result: RunHookResult | null) => void;
  /** Resolve the head prompt with `headResult`, then run every remaining queued hook with its default command. */
  runAllRunHookRequests: (headResult: RunHookResult) => void;
  /** Skip the entire queue — resolve every pending hook prompt with null. */
  skipAllRunHookRequests: () => void;

  /** Queue a CLI-initiated start for a project the user isn't currently viewing. */
  enqueueCliStart: (projectPath: string, start: PendingCliStart) => void;
  /** Atomically drain all queued starts for a project. */
  drainCliStarts: (projectPath: string) => PendingCliStart[];
}

type ProjectStore = ProjectStoreState & ProjectStoreActions;

let toastCounter = 0;
let moveCounter = 0;
let runHookRequestCounter = 0;
let configLoadVersion = 0;

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
  runHookQueue: [],
  runHookQueueTotal: 0,
  pendingCliStarts: {},
  sandboxAvailable: false,
  configuredHooks: {},
  configProjectPath: null,
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
    // Unblock any services awaiting a hook prompt before we drop the queue.
    for (const pending of get().runHookQueue) pending.resolve(null);
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
      runHookQueue: [],
      runHookQueueTotal: 0,
      sandboxAvailable: false,
      configuredHooks: {},
      configProjectPath: null,
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
      useAppStore.getState().updateProjectTaskCache(projectPath, tasks);
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

  loadProjectConfig: async (projectPath) => {
    // Version counter: a later call (e.g. user switched projects A → B while
    // A's IPC was still in flight) bumps the version, so when A's responses
    // arrive their `version !== configLoadVersion` check drops them.
    // Otherwise stale A config could land under project B.
    const version = ++configLoadVersion;
    try {
      const [status, hooks] = await Promise.all([
        window.api.lima.status(projectPath),
        window.api.hooks.get(projectPath),
      ]);
      if (version !== configLoadVersion) return;
      const configured: Record<string, boolean> = {};
      for (const key of Object.keys(hooks)) {
        if (hooks[key as HookType]) configured[key] = true;
      }
      set({
        sandboxAvailable: status.available,
        configuredHooks: configured,
        configProjectPath: projectPath,
      });
    } catch {
      // Swallow — project config (sandbox availability + configured hooks) is
      // a UX nicety; if IPC fails the cards just render with falsy defaults
      // and the user retries the action.
    }
  },

  markHookConfigured: (hookType) => {
    const prev = get().configuredHooks;
    if (prev[hookType]) return;
    set({ configuredHooks: { ...prev, [hookType]: true } });
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
      // Concurrent transitions (CLI / multi-select batch starts) each append a
      // request. They are presented one at a time as a stepper instead of the
      // newest evicting the prior one, so no start hook is silently dropped.
      const id = ++runHookRequestCounter;
      set((s) => ({
        runHookQueue: [...s.runHookQueue, { ...req, id, resolve }],
        runHookQueueTotal: s.runHookQueueTotal + 1,
      }));
    }),

  resolveRunHookRequest: (id, result) => {
    const queue = get().runHookQueue;
    const target = queue.find((r) => r.id === id);
    if (!target) return;
    const next = queue.filter((r) => r.id !== id);
    set({ runHookQueue: next, runHookQueueTotal: next.length === 0 ? 0 : get().runHookQueueTotal });
    target.resolve(result);
  },

  runAllRunHookRequests: (headResult) => {
    const queue = get().runHookQueue;
    if (queue.length === 0) return;
    const [head, ...rest] = queue;
    set({ runHookQueue: [], runHookQueueTotal: 0 });
    head.resolve(headResult);
    // Remaining hooks run with their default command in the background — the
    // user opted into a bulk action rather than reviewing each one.
    for (const req of rest) {
      req.resolve({ command: req.hook.command, sandboxed: false, foreground: false });
    }
  },

  skipAllRunHookRequests: () => {
    const queue = get().runHookQueue;
    if (queue.length === 0) return;
    set({ runHookQueue: [], runHookQueueTotal: 0 });
    for (const req of queue) req.resolve(null);
  },

  enqueueCliStart: (projectPath, start) => {
    const current = get().pendingCliStarts[projectPath] ?? [];
    if (current.some((s) => s.taskNumber === start.taskNumber)) return;
    set({
      pendingCliStarts: { ...get().pendingCliStarts, [projectPath]: [...current, start] },
    });
  },

  drainCliStarts: (projectPath) => {
    const queued = get().pendingCliStarts[projectPath];
    if (!queued || queued.length === 0) return [];
    const { [projectPath]: _drained, ...rest } = get().pendingCliStarts;
    set({ pendingCliStarts: rest });
    return queued;
  },
}));
