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
  branch: string;           // Unique identifier (the branch name)
  name: string;             // Display name
  status: 'open' | 'closed';
  createdAt: string;        // ISO timestamp
  closedAt?: string;        // When marked closed
}

/**
 * Store structure - tasks organized by project path
 */
interface TaskStore {
  [projectPath: string]: {
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
 * Create a new task entry
 */
export async function createTask(
  projectPath: string,
  branch: string,
  name: string
): Promise<TaskMetadata> {
  const store = await loadStore();

  if (!store[projectPath]) {
    store[projectPath] = { tasks: [] };
  }

  // Check if task already exists
  const existing = store[projectPath].tasks.find(t => t.branch === branch);
  if (existing) {
    return existing;
  }

  const task: TaskMetadata = {
    branch,
    name,
    status: 'open',
    createdAt: new Date().toISOString(),
  };

  store[projectPath].tasks.push(task);
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
  return createTask(projectPath, branch, name);
}
