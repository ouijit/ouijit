/**
 * SQLite-backed storage layer.
 *
 * Exports async wrapper functions that match the exact signatures of the old
 * JSON-based modules (taskMetadata.ts, projectSettings.ts, scanner.ts).
 * Callers just change their import path — no other code changes needed.
 */

import { getDatabase, _initTestDatabase } from './database';
import { ProjectRepo } from './repos/projectRepo';
import { TaskRepo, type TaskStatus, type TaskRow } from './repos/taskRepo';
import { SettingsRepo } from './repos/settingsRepo';
import { HookRepo, type HookType } from './repos/hookRepo';
import type { ProjectSettings, ScriptHook } from '../types';

// ── Re-exports ───────────────────────────────────────────────────────
export type { TaskStatus } from './repos/taskRepo';
export type { HookType } from './repos/hookRepo';

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

// ── Lazy singleton repos ─────────────────────────────────────────────

let projectRepo: ProjectRepo | null = null;
let taskRepo: TaskRepo | null = null;
let settingsRepo: SettingsRepo | null = null;
let hookRepo: HookRepo | null = null;

function repos() {
  if (!taskRepo) {
    const db = getDatabase();
    projectRepo = new ProjectRepo(db);
    taskRepo = new TaskRepo(db);
    settingsRepo = new SettingsRepo(db);
    hookRepo = new HookRepo(db);
  }
  return { projectRepo: projectRepo!, taskRepo: taskRepo!, settingsRepo: settingsRepo!, hookRepo: hookRepo! };
}

// ── Test helpers ─────────────────────────────────────────────────────

export function _resetCacheForTesting(): void {
  const db = _initTestDatabase();
  projectRepo = new ProjectRepo(db);
  taskRepo = new TaskRepo(db);
  settingsRepo = new SettingsRepo(db);
  hookRepo = new HookRepo(db);
}

// ── Row → TaskMetadata conversion ────────────────────────────────────

const STATUS_ORDER: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  in_review: 2,
  done: 3,
};

function rowToTask(row: TaskRow): TaskMetadata {
  return {
    taskNumber: row.task_number,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    order: row.sort_order,
    ...(row.branch && { branch: row.branch }),
    ...(row.closed_at && { closedAt: row.closed_at }),
    ...(row.worktree_path && { worktreePath: row.worktree_path }),
    ...(row.merge_target && { mergeTarget: row.merge_target }),
    ...(row.prompt && { prompt: row.prompt }),
    ...(row.sandboxed === 1 && { sandboxed: true }),
  };
}

// ── Ensure project exists (auto-create) ──────────────────────────────

function ensureProject(projectPath: string): void {
  const { projectRepo: pr } = repos();
  if (!pr.getByPath(projectPath)) {
    const name = projectPath.split('/').pop() || projectPath;
    pr.add(projectPath, name);
  }
}

// ── Task metadata functions (match taskMetadata.ts signatures) ───────

export async function getProjectTasks(projectPath: string): Promise<TaskMetadata[]> {
  const { taskRepo: tr } = repos();
  const rows = tr.getAllForProject(projectPath);
  return rows
    .map(rowToTask)
    .sort((a, b) => {
      const statusA = STATUS_ORDER[a.status];
      const statusB = STATUS_ORDER[b.status];
      if (statusA !== statusB) return statusA - statusB;
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export async function getTask(projectPath: string, branch: string): Promise<TaskMetadata | null> {
  const { taskRepo: tr } = repos();
  const row = tr.getByBranch(projectPath, branch);
  return row ? rowToTask(row) : null;
}

export async function getTaskByNumber(projectPath: string, taskNumber: number): Promise<TaskMetadata | null> {
  const { taskRepo: tr } = repos();
  const row = tr.getByTaskNumber(projectPath, taskNumber);
  return row ? rowToTask(row) : null;
}

export async function getNextTaskNumber(projectPath: string): Promise<number> {
  ensureProject(projectPath);
  const { taskRepo: tr } = repos();
  return tr.getNextTaskNumber(projectPath);
}

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
  },
): Promise<TaskMetadata> {
  ensureProject(projectPath);
  const { taskRepo: tr } = repos();

  // Match old behavior: if task already exists, return it
  const existing = tr.getByTaskNumber(projectPath, taskNumber);
  if (existing) return rowToTask(existing);

  const row = tr.create(projectPath, taskNumber, name, options);
  return rowToTask(row);
}

export async function setTaskStatus(
  projectPath: string,
  taskNumber: number,
  status: TaskStatus,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    const row = tr.getByTaskNumber(projectPath, taskNumber);
    if (!row) return { success: false, error: 'Task not found' };

    tr.updateStatus(projectPath, taskNumber, status);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskSandboxed(
  projectPath: string,
  taskNumber: number,
  sandboxed: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    const row = tr.getByTaskNumber(projectPath, taskNumber);
    if (!row) return { success: false, error: 'Task not found' };

    tr.updateSandboxed(projectPath, taskNumber, sandboxed);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskMergeTarget(
  projectPath: string,
  taskNumber: number,
  mergeTarget: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    const row = tr.getByTaskNumber(projectPath, taskNumber);
    if (!row) return { success: false, error: 'Task not found' };

    tr.updateMergeTarget(projectPath, taskNumber, mergeTarget);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskWorktreePath(
  projectPath: string,
  taskNumber: number,
  worktreePath: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    const row = tr.getByTaskNumber(projectPath, taskNumber);
    if (!row) return { success: false, error: 'Task not found' };

    tr.updateWorktreePath(projectPath, taskNumber, worktreePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskBranch(
  projectPath: string,
  taskNumber: number,
  branch: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    const row = tr.getByTaskNumber(projectPath, taskNumber);
    if (!row) return { success: false, error: 'Task not found' };

    tr.updateBranch(projectPath, taskNumber, branch);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskName(
  projectPath: string,
  taskNumber: number,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    const row = tr.getByTaskNumber(projectPath, taskNumber);
    if (!row) return { success: false, error: 'Task not found' };

    tr.updateName(projectPath, taskNumber, name);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setTaskDescription(
  projectPath: string,
  taskNumber: number,
  description: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    const row = tr.getByTaskNumber(projectPath, taskNumber);
    if (!row) return { success: false, error: 'Task not found' };

    tr.updatePrompt(projectPath, taskNumber, description || null);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteTaskByNumber(
  projectPath: string,
  taskNumber: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    tr.delete(projectPath, taskNumber);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function reorderTask(
  projectPath: string,
  taskNumber: number,
  newStatus: TaskStatus,
  targetIndex: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { taskRepo: tr } = repos();
    const row = tr.getByTaskNumber(projectPath, taskNumber);
    if (!row) return { success: false, error: 'Task not found' };

    tr.reorder(projectPath, taskNumber, newStatus, targetIndex);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ── Project settings functions (match projectSettings.ts signatures) ─

export async function getProjectSettings(projectPath: string): Promise<ProjectSettings> {
  const { settingsRepo: sr, hookRepo: hr } = repos();
  const settings = sr.get(projectPath);
  const hookRows = hr.getForProject(projectPath);

  const hooks: ProjectSettings['hooks'] = {};
  for (const row of hookRows) {
    hooks[row.type as keyof typeof hooks] = {
      id: row.id,
      type: row.type,
      name: row.name,
      command: row.command,
      ...(row.description && { description: row.description }),
    } as ScriptHook;
  }

  return {
    customCommands: [],
    hooks,
    killExistingOnRun: settings ? settings.kill_existing_on_run === 1 : undefined,
    ...(settings?.sandbox_memory_gib || settings?.sandbox_disk_gib
      ? {
          sandbox: {
            ...(settings.sandbox_memory_gib && { memoryGiB: settings.sandbox_memory_gib }),
            ...(settings.sandbox_disk_gib && { diskGiB: settings.sandbox_disk_gib }),
          },
        }
      : {}),
  };
}

export async function getHooks(
  projectPath: string,
): Promise<{ start?: ScriptHook; continue?: ScriptHook; run?: ScriptHook; cleanup?: ScriptHook; 'sandbox-setup'?: ScriptHook; editor?: ScriptHook }> {
  const settings = await getProjectSettings(projectPath);
  return settings.hooks || {};
}

export async function getHook(
  projectPath: string,
  hookType: HookType,
): Promise<ScriptHook | undefined> {
  const hooks = await getHooks(projectPath);
  return hooks[hookType];
}

export async function saveHook(
  projectPath: string,
  hook: ScriptHook,
): Promise<{ success: boolean }> {
  try {
    ensureProject(projectPath);
    const { hookRepo: hr } = repos();
    hr.save(projectPath, hook.type as HookType, hook.name, hook.command, hook.id, hook.description);
    return { success: true };
  } catch (error) {
    console.error('Failed to save hook:', error);
    return { success: false };
  }
}

export async function deleteHook(
  projectPath: string,
  hookType: HookType,
): Promise<{ success: boolean }> {
  try {
    const { hookRepo: hr } = repos();
    hr.deleteByType(projectPath, hookType);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete hook:', error);
    return { success: false };
  }
}

export async function getSandboxConfig(
  projectPath: string,
): Promise<{ memoryGiB: number; diskGiB: number }> {
  const { settingsRepo: sr } = repos();
  const settings = sr.get(projectPath);
  return {
    memoryGiB: settings?.sandbox_memory_gib ?? 4,
    diskGiB: settings?.sandbox_disk_gib ?? 100,
  };
}

export async function setSandboxConfig(
  projectPath: string,
  config: { memoryGiB?: number; diskGiB?: number },
): Promise<{ success: boolean }> {
  try {
    ensureProject(projectPath);
    const { settingsRepo: sr } = repos();
    sr.update(projectPath, {
      ...(config.memoryGiB !== undefined && { sandbox_memory_gib: config.memoryGiB }),
      ...(config.diskGiB !== undefined && { sandbox_disk_gib: config.diskGiB }),
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to set sandbox config:', error);
    return { success: false };
  }
}

export async function setKillExistingOnRun(
  projectPath: string,
  kill: boolean,
): Promise<{ success: boolean }> {
  try {
    ensureProject(projectPath);
    const { settingsRepo: sr } = repos();
    sr.update(projectPath, { kill_existing_on_run: kill ? 1 : 0 });
    return { success: true };
  } catch (error) {
    console.error('Failed to set killExistingOnRun:', error);
    return { success: false };
  }
}

// ── Scanner functions (match scanner.ts signatures for added-projects) ─

export async function getAddedProjects(): Promise<string[]> {
  const { projectRepo: pr } = repos();
  return pr.getAll().map(p => p.path);
}

export async function addProject(folderPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    const fs = await import('node:fs/promises');
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return { success: false, error: 'Path is not a directory' };
    }
    const path = await import('node:path');
    const name = path.basename(folderPath);
    const { projectRepo: pr } = repos();
    pr.add(folderPath, name);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function removeProject(folderPath: string): Promise<{ success: boolean }> {
  const { projectRepo: pr } = repos();
  pr.remove(folderPath);
  return { success: true };
}
