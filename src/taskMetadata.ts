/**
 * Task metadata storage for tracking task lifecycle (active/completed state)
 * Follows the pattern established in projectSettings.ts
 */

import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const METADATA_FILE = 'task-metadata.json';

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export interface TaskMetadata {
  taskNumber: number;
  branch?: string;
  name: string;
  status: TaskStatus;
  createdAt: string;
  closedAt?: string;
  worktreePath?: string;
  mergeTarget?: string;
  prompt?: string;
  sandboxed?: boolean;
  order?: number;
}

interface ProjectData {
  nextTaskNumber: number;
  tasks: TaskMetadata[];
}

interface TaskStore {
  __schemaVersion?: number;
  [projectPath: string]: ProjectData | number | undefined;
}

function getProjectData(store: TaskStore, projectPath: string): ProjectData | undefined {
  const data = store[projectPath];
  if (data && typeof data === 'object') return data as ProjectData;
  return undefined;
}

let storeCache: TaskStore | null = null;

/**
 * Get the path to the metadata file
 */
function getMetadataPath(): string {
  return path.join(app.getPath('userData'), METADATA_FILE);
}

function migrateStore(store: TaskStore): boolean {
  const version = store.__schemaVersion ?? 0;
  if (version >= 2) return false;

  // v0/v1 → v2: status migration
  for (const key of Object.keys(store)) {
    if (key === '__schemaVersion') continue;
    const projectData = getProjectData(store, key);
    if (!projectData) continue;

    for (const task of projectData.tasks) {
      const old = task as TaskMetadata & { readyToShip?: boolean };
      if (old.status === 'closed' as string) {
        (task as TaskMetadata).status = 'done';
      } else if (old.status === 'open' as string && old.readyToShip) {
        (task as TaskMetadata).status = 'in_review';
      } else if (old.status === 'open' as string) {
        (task as TaskMetadata).status = 'in_progress';
      }
      delete old.readyToShip;
    }
  }

  store.__schemaVersion = 2;
  return true;
}

async function loadStore(): Promise<TaskStore> {
  if (storeCache) {
    return storeCache;
  }

  try {
    const content = await fs.readFile(getMetadataPath(), 'utf-8');
    storeCache = JSON.parse(content);
    if (migrateStore(storeCache!)) {
      await fs.writeFile(getMetadataPath(), JSON.stringify(storeCache, null, 2), 'utf-8');
    }
    return storeCache!;
  } catch {
    storeCache = {};
    return storeCache;
  }
}

export function _resetCacheForTesting(): void {
  storeCache = null;
}

/**
 * Save all task metadata to disk
 */
async function saveStore(store: TaskStore): Promise<void> {
  storeCache = store;
  await fs.writeFile(getMetadataPath(), JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Get all tasks for a project (active first, then completed by most recent)
 */
const STATUS_ORDER: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  in_review: 2,
  done: 3,
};

export async function getProjectTasks(projectPath: string): Promise<TaskMetadata[]> {
  const store = await loadStore();
  const projectData = getProjectData(store, projectPath);
  if (!projectData) {
    return [];
  }

  return [...projectData.tasks].sort((a, b) => {
    const statusA = STATUS_ORDER[a.status];
    const statusB = STATUS_ORDER[b.status];
    if (statusA !== statusB) return statusA - statusB;
    // Sort by order within same status (fallback to createdAt for legacy data)
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * Get a single task by branch name
 */
export async function getTask(projectPath: string, branch: string): Promise<TaskMetadata | null> {
  const store = await loadStore();
  const projectData = getProjectData(store, projectPath);
  if (!projectData) {
    return null;
  }
  return projectData.tasks.find(t => t.branch === branch) || null;
}

export async function getTaskByNumber(projectPath: string, taskNumber: number): Promise<TaskMetadata | null> {
  const store = await loadStore();
  const projectData = getProjectData(store, projectPath);
  if (!projectData) {
    return null;
  }
  return projectData.tasks.find(t => t.taskNumber === taskNumber) || null;
}

/**
 * Delete a task by task number
 */
export async function deleteTaskByNumber(
  projectPath: string,
  taskNumber: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: true };
    }

    projectData.tasks = projectData.tasks.filter(t => t.taskNumber !== taskNumber);
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Initialize project store if needed, returns the store
 */
async function ensureProjectStore(projectPath: string): Promise<{ store: TaskStore; projectData: ProjectData }> {
  const store = await loadStore();
  let projectData = getProjectData(store, projectPath);
  if (!projectData) {
    projectData = { nextTaskNumber: 1, tasks: [] };
    store[projectPath] = projectData;
  }
  if (!projectData.nextTaskNumber) {
    const maxNumber = projectData.tasks.reduce((max, t) => {
      return t.taskNumber ? Math.max(max, t.taskNumber) : max;
    }, 0);
    projectData.nextTaskNumber = maxNumber + 1;
  }
  return { store, projectData };
}

/**
 * Get the next task number for a project without persisting
 * The counter is only incremented when createTask is called
 */
export async function getNextTaskNumber(projectPath: string): Promise<number> {
  const { projectData } = await ensureProjectStore(projectPath);
  return projectData.nextTaskNumber;
}

/**
 * Create a new task entry with explicit task number
 * Also increments nextTaskNumber if this task number matches it
 */
export async function createTask(
  projectPath: string,
  taskNumber: number,
  name: string,
  options?: {
    branch?: string;
    status?: TaskStatus;
    mergeTarget?: string;
    prompt?: string;
    sandboxed?: boolean;
    worktreePath?: string;
  }
): Promise<TaskMetadata> {
  const { store, projectData } = await ensureProjectStore(projectPath);

  const existing = projectData.tasks.find(t => t.taskNumber === taskNumber);
  if (existing) {
    return existing;
  }

  const status = options?.status ?? 'in_progress';

  const task: TaskMetadata = {
    taskNumber,
    name,
    status,
    createdAt: new Date().toISOString(),
    ...(options?.branch && { branch: options.branch }),
    ...(options?.worktreePath && { worktreePath: options.worktreePath }),
    ...(options?.mergeTarget && { mergeTarget: options.mergeTarget }),
    ...(options?.prompt && { prompt: options.prompt }),
    ...(options?.sandboxed !== undefined && { sandboxed: options.sandboxed }),
  };

  projectData.tasks.push(task);

  if (taskNumber >= projectData.nextTaskNumber) {
    projectData.nextTaskNumber = taskNumber + 1;
  }

  await saveStore(store);
  return task;
}

export async function setTaskStatus(
  projectPath: string,
  taskNumber: number,
  status: TaskStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.taskNumber === taskNumber);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    const oldStatus = task.status;
    task.status = status;
    if (status === 'done') {
      task.closedAt = new Date().toISOString();
    } else {
      delete task.closedAt;
    }

    // When moving to a different column, manage order values
    if (oldStatus !== status) {
      // Append to end of new column
      const maxOrder = projectData.tasks
        .filter(t => t.status === status && t.taskNumber !== taskNumber)
        .reduce((max, t) => Math.max(max, t.order ?? -1), -1);
      task.order = maxOrder + 1;

      // Compact old column orders
      const oldColumnTasks = projectData.tasks
        .filter(t => t.status === oldStatus && t.taskNumber !== taskNumber)
        .sort((a, b) => {
          const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) return orderA - orderB;
          return a.createdAt.localeCompare(b.createdAt);
        });
      for (let i = 0; i < oldColumnTasks.length; i++) {
        oldColumnTasks[i].order = i;
      }
    }

    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to set task status:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskSandboxed(
  projectPath: string,
  taskNumber: number,
  sandboxed: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.taskNumber === taskNumber);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (sandboxed) {
      task.sandboxed = true;
    } else {
      delete task.sandboxed;
    }
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to set task sandboxed state:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskMergeTarget(
  projectPath: string,
  taskNumber: number,
  mergeTarget: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.taskNumber === taskNumber);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.mergeTarget = mergeTarget;
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to set task merge target:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskWorktreePath(
  projectPath: string,
  taskNumber: number,
  worktreePath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.taskNumber === taskNumber);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.worktreePath = worktreePath;
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to set task worktree path:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskBranch(
  projectPath: string,
  taskNumber: number,
  branch: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.taskNumber === taskNumber);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.branch = branch;
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to set task branch:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskName(
  projectPath: string,
  taskNumber: number,
  name: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.taskNumber === taskNumber);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.name = name;
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to set task name:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskDescription(
  projectPath: string,
  taskNumber: number,
  description: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.taskNumber === taskNumber);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (description) {
      task.prompt = description;
    } else {
      delete task.prompt;
    }
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to set task description:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Reorder a task within its column or move it to a new column at a specific position.
 * Reassigns integer order values for the affected column(s).
 */
export async function reorderTask(
  projectPath: string,
  taskNumber: number,
  newStatus: TaskStatus,
  targetIndex: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = getProjectData(store, projectPath);

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.taskNumber === taskNumber);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    const oldStatus = task.status;

    // Update status and closedAt
    task.status = newStatus;
    if (newStatus === 'done') {
      task.closedAt = new Date().toISOString();
    } else if (oldStatus === 'done') {
      delete task.closedAt;
    }

    // Get tasks in the target column (excluding the moved task)
    const columnTasks = projectData.tasks
      .filter(t => t.status === newStatus && t.taskNumber !== taskNumber)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Insert at the target position
    const clampedIndex = Math.max(0, Math.min(targetIndex, columnTasks.length));
    columnTasks.splice(clampedIndex, 0, task);

    // Reassign order values for the target column
    for (let i = 0; i < columnTasks.length; i++) {
      columnTasks[i].order = i;
    }

    // If moving across columns, also reassign the old column's order values
    if (oldStatus !== newStatus) {
      const oldColumnTasks = projectData.tasks
        .filter(t => t.status === oldStatus && t.taskNumber !== taskNumber)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (let i = 0; i < oldColumnTasks.length; i++) {
        oldColumnTasks[i].order = i;
      }
    }

    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to reorder task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

