import { create } from 'zustand';
import type {
  TaskWithWorkspace,
  ScriptHook,
  HookType,
  CliHookControl,
  TaskStatus,
  SandboxProviderId,
  RunHookResult,
} from '../types';
import { queuePrompt, settlePrompt, settleAllPrompts, type Pending } from './promptQueue';

export type TerminalLayout = 'stack' | 'canvas';

export interface RunHookInput {
  projectPath: string;
  hookType: HookType;
  hook: ScriptHook;
  task: TaskWithWorkspace;
  /** What the dialog preselects, and what "Run all" uses for the hooks behind it. */
  sandbox: SandboxProviderId;
}

export type RunHookRequest = RunHookInput & Pending<RunHookResult | null>;

export interface PendingCliStart extends CliHookControl {
  taskNumber: number;
  worktreePath: string;
  branch: string;
  createdAt: string;
}

/**
 * A CLI-initiated in_progress/in_review transition awaiting a hook spawn. Queued
 * like {@link PendingCliStart} when the user isn't viewing the project, and
 * drained on navigation. Carries the full task and origStatus so the renderer
 * can run the same beginTransition path a kanban drop would.
 */
export interface PendingCliTransition extends CliHookControl {
  taskNumber: number;
  origStatus: TaskStatus;
  newStatus: TaskStatus;
  task: TaskWithWorkspace;
}

/**
 * A CLI-initiated done transition awaiting its lifecycle. Queued like
 * {@link PendingCliStart} when a *bare* done (which shows the Done dialog) lands
 * for a project the user isn't viewing, and drained on navigation. A done with
 * explicit hook flags runs headlessly and is never queued.
 */
export interface PendingCliCompletion extends CliHookControl {
  taskNumber: number;
  task: TaskWithWorkspace;
}

interface ProjectStoreState {
  kanbanVisible: boolean;
  terminalLayout: TerminalLayout;
  activePanel: 'terminals' | 'settings' | 'pull-requests' | 'analysis';
  /** When set, the terminal stack and canvas show only sessions whose task has this tag. */
  tagFilter: string | null;
  highlightedChainTask: number | null;
  detachHoverParent: number | null;
  optionKeyHeld: boolean;
  /** True while Shift is held — shift-drag to the done column skips the done hook. */
  shiftKeyHeld: boolean;
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
  pendingCliTransitions: Record<string, PendingCliTransition[]>;
  pendingCliCompletions: Record<string, PendingCliCompletion[]>;
}

interface ProjectStoreActions {
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
  setActivePanel: (panel: 'terminals' | 'settings' | 'pull-requests' | 'analysis') => void;
  setTagFilter: (tag: string | null) => void;

  toggleTaskSelection: (taskNumber: number) => void;
  selectTaskRange: (taskNumber: number, orderedTaskNumbers: number[]) => void;
  clearSelection: () => void;
  /** Drop selected tasks that are no longer in the board's list. */
  pruneSelection: (tasks: TaskWithWorkspace[]) => void;

  /** Mark a task as starting (worktree being created). Does not depend on any view being mounted. */
  markTaskStarting: (taskNumber: number) => void;
  markTaskStartingDone: (taskNumber: number) => void;

  /** Enqueue a hook-prompt dialog and return a promise that resolves with the user's choice. */
  requestRunHook: (req: RunHookInput) => Promise<RunHookResult | null>;
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

  /** Queue a CLI-initiated in_progress/in_review transition for a project the user isn't viewing. */
  enqueueCliTransition: (projectPath: string, transition: PendingCliTransition) => void;
  /** Atomically drain all queued transitions for a project. */
  drainCliTransitions: (projectPath: string) => PendingCliTransition[];

  /** Queue a CLI-initiated done transition for a project the user isn't viewing. */
  enqueueCliCompletion: (projectPath: string, completion: PendingCliCompletion) => void;
  /** Atomically drain all queued completions for a project. */
  drainCliCompletions: (projectPath: string) => PendingCliCompletion[];
}

type ProjectStore = ProjectStoreState & ProjectStoreActions;

let toastCounter = 0;

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  kanbanVisible: false,
  terminalLayout: 'stack',
  activePanel: 'terminals',
  tagFilter: null,
  highlightedChainTask: null,
  detachHoverParent: null,
  optionKeyHeld: false,
  shiftKeyHeld: false,
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
  pendingCliTransitions: {},
  pendingCliCompletions: {},

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

  setTagFilter: (tag) => set({ tagFilter: tag }),

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

  pruneSelection: (tasks) => {
    const { selectedTaskNumbers, selectionAnchor } = get();
    if (selectedTaskNumbers.size === 0) return;
    const valid = new Set(tasks.map((t) => t.taskNumber));
    const pruned = new Set([...selectedTaskNumbers].filter((n) => valid.has(n)));
    if (pruned.size === selectedTaskNumbers.size) return;
    set({ selectedTaskNumbers: pruned, selectionAnchor: pruned.size > 0 ? selectionAnchor : null });
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
    // What arrives concurrently: CLI starts and multi-select batch starts.
    queuePrompt<RunHookInput, RunHookResult | null>(req, (entry) =>
      set((s) => ({
        runHookQueue: [...s.runHookQueue, entry],
        runHookQueueTotal: s.runHookQueueTotal + 1,
      })),
    ),

  resolveRunHookRequest: (id, result) => {
    const next = settlePrompt(get().runHookQueue, id, result);
    if (!next) return;
    set({ runHookQueue: next, runHookQueueTotal: next.length === 0 ? 0 : get().runHookQueueTotal });
  },

  runAllRunHookRequests: (headResult) => {
    const queue = get().runHookQueue;
    if (queue.length === 0) return;
    // Everything behind the head runs with its default command in the
    // background — the user opted into a bulk action rather than reviewing
    // each one.
    set({
      runHookQueue: settleAllPrompts(queue, (req, index) =>
        index === 0 ? headResult : { command: req.hook.command, foreground: false, sandbox: req.sandbox },
      ),
      runHookQueueTotal: 0,
    });
  },

  skipAllRunHookRequests: () => {
    const queue = get().runHookQueue;
    if (queue.length === 0) return;
    set({ runHookQueue: settleAllPrompts(queue, (): RunHookResult | null => null), runHookQueueTotal: 0 });
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

  enqueueCliTransition: (projectPath, transition) => {
    const current = get().pendingCliTransitions[projectPath] ?? [];
    if (current.some((t) => t.taskNumber === transition.taskNumber)) return;
    set({
      pendingCliTransitions: { ...get().pendingCliTransitions, [projectPath]: [...current, transition] },
    });
  },

  drainCliTransitions: (projectPath) => {
    const queued = get().pendingCliTransitions[projectPath];
    if (!queued || queued.length === 0) return [];
    const { [projectPath]: _drained, ...rest } = get().pendingCliTransitions;
    set({ pendingCliTransitions: rest });
    return queued;
  },

  enqueueCliCompletion: (projectPath, completion) => {
    const current = get().pendingCliCompletions[projectPath] ?? [];
    if (current.some((c) => c.taskNumber === completion.taskNumber)) return;
    set({
      pendingCliCompletions: { ...get().pendingCliCompletions, [projectPath]: [...current, completion] },
    });
  },

  drainCliCompletions: (projectPath) => {
    const queued = get().pendingCliCompletions[projectPath];
    if (!queued || queued.length === 0) return [];
    const { [projectPath]: _drained, ...rest } = get().pendingCliCompletions;
    set({ pendingCliCompletions: rest });
    return queued;
  },
}));
