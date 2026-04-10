import { create } from 'zustand';
import type { TaskWithWorkspace, Script } from '../types';

interface ProjectStoreState {
  tasks: TaskWithWorkspace[];
  kanbanVisible: boolean;
  activePanel: 'terminals' | 'settings';
  scripts: Script[];
  taskVersion: number;
  highlightedChainTask: number | null;
  activeModal: string | null;
  toasts: Array<{
    id: string;
    message: string;
    type: 'info' | 'error' | 'success';
    persistent?: boolean;
    actionLabel?: string;
    onAction?: () => void;
  }>;
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
  setActivePanel: (panel: 'terminals' | 'settings') => void;
  resetForProject: () => void;

  /** Load tasks from IPC with staleness check */
  loadTasks: (projectPath: string) => Promise<void>;
  /** Load scripts from IPC */
  loadScripts: (projectPath: string) => Promise<void>;
  /** Move a task with optimistic update and rollback */
  moveTask: (projectPath: string, taskNumber: number, newStatus: string, targetIndex: number) => Promise<void>;
}

type ProjectStore = ProjectStoreState & ProjectStoreActions;

let toastCounter = 0;

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  tasks: [],
  kanbanVisible: false,
  activePanel: 'terminals',
  scripts: [],
  taskVersion: 0,
  highlightedChainTask: null,
  activeModal: null,
  toasts: [],
  _version: 0,

  setTasks: (tasks) => set({ tasks }),

  invalidateTaskList: () => set((s) => ({ taskVersion: s.taskVersion + 1 })),

  setKanbanVisible: (visible) => set({ kanbanVisible: visible }),

  toggleKanban: () => set((s) => ({ kanbanVisible: !s.kanbanVisible })),

  setHighlightedChainTask: (taskNumber) => set({ highlightedChainTask: taskNumber }),

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
    set({
      tasks: [],
      kanbanVisible: false,
      activePanel: 'terminals',
      scripts: [],
      taskVersion: 0,
      highlightedChainTask: null,
      activeModal: null,
      _version: 0,
    });
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
    // Optimistic: reorder locally
    const task = prev.find((t) => t.taskNumber === taskNumber);
    if (!task) return;
    const updated = prev.filter((t) => t.taskNumber !== taskNumber);
    const updatedTask = { ...task, status: newStatus as TaskWithWorkspace['status'] };
    // Insert at target position within the status group
    const statusTasks = updated.filter((t) => t.status === newStatus);
    const otherTasks = updated.filter((t) => t.status !== newStatus);
    statusTasks.splice(targetIndex, 0, updatedTask);
    set({ tasks: [...otherTasks, ...statusTasks] });

    try {
      const result = await window.api.task.reorder(projectPath, taskNumber, newStatus as any, targetIndex);
      if (!result.success) {
        set({ tasks: prev });
        get().addToast('Failed to move task', 'error');
      }
    } catch {
      set({ tasks: prev });
      get().addToast('Failed to move task', 'error');
    }
  },
}));
