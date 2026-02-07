/**
 * Task metadata storage for tracking task lifecycle (active/completed state)
 * Follows the pattern established in projectSettings.ts
 */

import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const METADATA_FILE = 'task-metadata.json';

/**
 * Metadata for a single task
 */
export interface TaskMetadata {
  taskNumber: number;       // Sequential number (1, 2, 3...) - displayed as T-{taskNumber}
  branch: string;           // Git branch name (descriptive)
  name: string;             // Display name
  status: 'open' | 'closed';
  createdAt: string;        // ISO timestamp
  closedAt?: string;        // When marked closed
  readyToShip?: boolean;    // "Spiritually done" - code complete, pending merge/review
  mergeTarget?: string;     // Branch to merge into (defaults to main if unset)
  prompt?: string;          // Optional task description (OUIJIT_TASK_PROMPT)
  sandboxed?: boolean;      // Whether this task runs in a sandbox VM
}

/**
 * Store structure - tasks organized by project path
 */
interface TaskStore {
  [projectPath: string]: {
    nextTaskNumber: number;  // Counter for assigning task numbers
    tasks: TaskMetadata[];
  };
}

let storeCache: TaskStore | null = null;

/**
 * Get the path to the metadata file
 */
function getMetadataPath(): string {
  return path.join(app.getPath('userData'), METADATA_FILE);
}

/**
 * Load all task metadata from disk
 */
async function loadStore(): Promise<TaskStore> {
  if (storeCache) {
    return storeCache;
  }

  try {
    const content = await fs.readFile(getMetadataPath(), 'utf-8');
    storeCache = JSON.parse(content);
    return storeCache!;
  } catch {
    storeCache = {};
    return storeCache;
  }
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
export async function getProjectTasks(projectPath: string): Promise<TaskMetadata[]> {
  const store = await loadStore();
  const projectData = store[projectPath];
  if (!projectData) {
    return [];
  }

  // Sort: open tasks first (by createdAt desc), then closed (by closedAt desc)
  return [...projectData.tasks].sort((a, b) => {
    // Open before closed
    if (a.status !== b.status) {
      return a.status === 'open' ? -1 : 1;
    }
    // Within same status, sort by relevant timestamp (newest first)
    const dateA = a.status === 'closed' && a.closedAt ? a.closedAt : a.createdAt;
    const dateB = b.status === 'closed' && b.closedAt ? b.closedAt : b.createdAt;
    return dateB.localeCompare(dateA);
  });
}

/**
 * Get a single task by branch name
 */
export async function getTask(projectPath: string, branch: string): Promise<TaskMetadata | null> {
  const store = await loadStore();
  const projectData = store[projectPath];
  if (!projectData) {
    return null;
  }
  return projectData.tasks.find(t => t.branch === branch) || null;
}

/**
 * Get a single task by task number
 */
export async function getTaskByNumber(projectPath: string, taskNumber: number): Promise<TaskMetadata | null> {
  const store = await loadStore();
  const projectData = store[projectPath];
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
    const projectData = store[projectPath];

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
async function ensureProjectStore(projectPath: string): Promise<TaskStore> {
  const store = await loadStore();
  if (!store[projectPath]) {
    store[projectPath] = { nextTaskNumber: 1, tasks: [] };
  }
  // Handle legacy stores without nextTaskNumber
  if (!store[projectPath].nextTaskNumber) {
    const maxNumber = store[projectPath].tasks.reduce((max, t) => {
      return t.taskNumber ? Math.max(max, t.taskNumber) : max;
    }, 0);
    store[projectPath].nextTaskNumber = maxNumber + 1;
  }
  return store;
}

/**
 * Get the next task number for a project without persisting
 * The counter is only incremented when createTask is called
 */
export async function getNextTaskNumber(projectPath: string): Promise<number> {
  const store = await ensureProjectStore(projectPath);
  return store[projectPath].nextTaskNumber;
}

/**
 * Create a new task entry with explicit task number
 * Also increments nextTaskNumber if this task number matches it
 */
export async function createTask(
  projectPath: string,
  taskNumber: number,
  branch: string,
  name: string,
  mergeTarget?: string,
  prompt?: string,
  sandboxed?: boolean
): Promise<TaskMetadata> {
  const store = await ensureProjectStore(projectPath);

  // Check if task already exists with this number
  const existing = store[projectPath].tasks.find(t => t.taskNumber === taskNumber);
  if (existing) {
    return existing;
  }

  const task: TaskMetadata = {
    taskNumber,
    branch,
    name,
    status: 'open',
    createdAt: new Date().toISOString(),
    ...(mergeTarget && { mergeTarget }),
    ...(prompt && { prompt }),
    ...(sandboxed !== undefined && { sandboxed }),
  };

  store[projectPath].tasks.push(task);

  // Increment counter if this was the next expected number
  if (taskNumber >= store[projectPath].nextTaskNumber) {
    store[projectPath].nextTaskNumber = taskNumber + 1;
  }

  await saveStore(store);
  return task;
}

/**
 * Mark a task as closed
 */
export async function closeTask(
  projectPath: string,
  branch: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = store[projectPath];

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.branch === branch);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.status = 'closed';
    task.closedAt = new Date().toISOString();
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to close task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Reopen a closed task
 */
export async function reopenTask(
  projectPath: string,
  branch: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = store[projectPath];

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.branch === branch);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.status = 'open';
    delete task.closedAt;
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to reopen task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Set a task's ready-to-ship state ("spiritually done")
 */
export async function setTaskReadyToShip(
  projectPath: string,
  branch: string,
  ready: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = store[projectPath];

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.branch === branch);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (ready) {
      task.readyToShip = true;
    } else {
      delete task.readyToShip;
    }
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to set task ready state:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Set a task's sandboxed state
 */
export async function setTaskSandboxed(
  projectPath: string,
  branch: string,
  sandboxed: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = store[projectPath];

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.branch === branch);
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

/**
 * Set a task's merge target branch
 */
export async function setTaskMergeTarget(
  projectPath: string,
  branch: string,
  mergeTarget: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = store[projectPath];

    if (!projectData) {
      return { success: false, error: 'Project not found' };
    }

    const task = projectData.tasks.find(t => t.branch === branch);
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

/**
 * Remove a task from the store (for hard delete)
 */
export async function deleteTask(
  projectPath: string,
  branch: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await loadStore();
    const projectData = store[projectPath];

    if (!projectData) {
      return { success: true }; // Already doesn't exist
    }

    projectData.tasks = projectData.tasks.filter(t => t.branch !== branch);
    await saveStore(store);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Ensure a task exists in metadata (creates if missing)
 * Used when listing worktrees to sync metadata with actual git worktrees
 */
export async function ensureTaskExists(
  projectPath: string,
  branch: string,
  name: string
): Promise<TaskMetadata> {
  const existing = await getTask(projectPath, branch);
  if (existing) {
    return existing;
  }
  const taskNumber = await getNextTaskNumber(projectPath);
  return createTask(projectPath, taskNumber, branch, name);
}
