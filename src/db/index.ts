/**
 * SQLite-backed storage layer.
 *
 * Exports async wrapper functions that match the exact signatures of the old
 * JSON-based modules (taskMetadata.ts, projectSettings.ts, scanner.ts).
 * Callers just change their import path — no other code changes needed.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getDatabase, _initTestDatabase } from './database';
import { ProjectRepo } from './repos/projectRepo';
import { TaskRepo, type TaskStatus, type TaskRow } from './repos/taskRepo';
import { SettingsRepo } from './repos/settingsRepo';
import { HookRepo, type HookType } from './repos/hookRepo';
import { TagRepo, type TagRow } from './repos/tagRepo';
import { GlobalSettingsRepo } from './repos/globalSettingsRepo';
import { ScriptRepo, type ScriptRow } from './repos/scriptRepo';
import type { ProjectSettings, ScriptHook } from '../types';
import log from '../log';

const dbLog = log.scope('db');

// ── Re-exports ───────────────────────────────────────────────────────
export type { TaskStatus } from './repos/taskRepo';
export type { HookType } from './repos/hookRepo';
export type { TagRow } from './repos/tagRepo';

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
let tagRepo: TagRepo | null = null;
let globalSettingsRepo: GlobalSettingsRepo | null = null;
let scriptRepo: ScriptRepo | null = null;

function repos() {
  if (!taskRepo) {
    const db = getDatabase();
    projectRepo = new ProjectRepo(db);
    taskRepo = new TaskRepo(db);
    settingsRepo = new SettingsRepo(db);
    hookRepo = new HookRepo(db);
    tagRepo = new TagRepo(db);
    globalSettingsRepo = new GlobalSettingsRepo(db);
    scriptRepo = new ScriptRepo(db);
  }
  return {
    projectRepo: projectRepo!,
    taskRepo: taskRepo!,
    settingsRepo: settingsRepo!,
    hookRepo: hookRepo!,
    tagRepo: tagRepo!,
    globalSettingsRepo: globalSettingsRepo!,
    scriptRepo: scriptRepo!,
  };
}

// ── Test helpers ─────────────────────────────────────────────────────

export function _resetCacheForTesting(): void {
  const db = _initTestDatabase();
  projectRepo = new ProjectRepo(db);
  taskRepo = new TaskRepo(db);
  settingsRepo = new SettingsRepo(db);
  hookRepo = new HookRepo(db);
  tagRepo = new TagRepo(db);
  globalSettingsRepo = new GlobalSettingsRepo(db);
  scriptRepo = new ScriptRepo(db);
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
  return rows.map(rowToTask).sort((a, b) => {
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
  };
}

export async function getHooks(projectPath: string): Promise<{
  start?: ScriptHook;
  continue?: ScriptHook;
  run?: ScriptHook;
  review?: ScriptHook;
  cleanup?: ScriptHook;
  editor?: ScriptHook;
}> {
  const settings = await getProjectSettings(projectPath);
  return settings.hooks || {};
}

export async function getHook(projectPath: string, hookType: HookType): Promise<ScriptHook | undefined> {
  const hooks = await getHooks(projectPath);
  return hooks[hookType];
}

export async function saveHook(projectPath: string, hook: ScriptHook): Promise<{ success: boolean }> {
  try {
    ensureProject(projectPath);
    const { hookRepo: hr } = repos();
    hr.save(projectPath, hook.type as HookType, hook.name, hook.command, hook.id, hook.description);
    return { success: true };
  } catch (error) {
    dbLog.error('failed to save hook', { error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}

export async function deleteHook(projectPath: string, hookType: HookType): Promise<{ success: boolean }> {
  try {
    const { hookRepo: hr } = repos();
    hr.deleteByType(projectPath, hookType);
    return { success: true };
  } catch (error) {
    dbLog.error('failed to delete hook', { error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}

export async function setKillExistingOnRun(projectPath: string, kill: boolean): Promise<{ success: boolean }> {
  try {
    ensureProject(projectPath);
    const { settingsRepo: sr } = repos();
    sr.update(projectPath, { kill_existing_on_run: kill ? 1 : 0 });
    return { success: true };
  } catch (error) {
    dbLog.error('failed to set killExistingOnRun', { error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}

// ── Project management functions ─────────────────────────────────────

export async function addProject(folderPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return { success: false, error: 'Path is not a directory' };
    }
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

export async function reorderProjects(paths: string[]): Promise<{ success: boolean }> {
  try {
    const { projectRepo: pr } = repos();
    pr.reorder(paths);
    return { success: true };
  } catch (error) {
    dbLog.error('failed to reorder projects', { error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}

// ── Tag functions ────────────────────────────────────────────────────

export async function getAllTags(): Promise<TagRow[]> {
  const { tagRepo: tr } = repos();
  return tr.getAll();
}

export async function getTaskTags(projectPath: string, taskNumber: number): Promise<TagRow[]> {
  const { tagRepo: tr } = repos();
  return tr.getForTask(projectPath, taskNumber);
}

export async function addTagToTask(projectPath: string, taskNumber: number, tagName: string): Promise<TagRow> {
  const { tagRepo: tr } = repos();
  return tr.addToTask(projectPath, taskNumber, tagName);
}

export async function removeTagFromTask(projectPath: string, taskNumber: number, tagName: string): Promise<void> {
  const { tagRepo: tr } = repos();
  tr.removeFromTask(projectPath, taskNumber, tagName);
}

export async function setTaskTags(projectPath: string, taskNumber: number, tagNames: string[]): Promise<TagRow[]> {
  const { tagRepo: tr } = repos();
  return tr.setTaskTags(projectPath, taskNumber, tagNames);
}

// ── Global settings functions ────────────────────────────────────────

export async function getGlobalSetting(key: string): Promise<string | undefined> {
  const { globalSettingsRepo: gr } = repos();
  return gr.get(key);
}

export async function setGlobalSetting(key: string, value: string): Promise<{ success: boolean }> {
  try {
    const { globalSettingsRepo: gr } = repos();
    gr.set(key, value);
    return { success: true };
  } catch (error) {
    dbLog.error('failed to set global setting', { key, error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}

// ── Script functions ────────────────────────────────────────────────

export interface Script {
  id: string;
  name: string;
  command: string;
  sortOrder: number;
}

function rowToScript(row: ScriptRow): Script {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    sortOrder: row.sort_order,
  };
}

export async function getScripts(projectPath: string): Promise<Script[]> {
  const { scriptRepo: sr } = repos();
  return sr.getAll(projectPath).map(rowToScript);
}

export async function saveScript(projectPath: string, script: Script): Promise<{ success: boolean; script?: Script }> {
  try {
    ensureProject(projectPath);
    const { scriptRepo: sr } = repos();
    const row = sr.save(projectPath, script.name, script.command, script.id);
    return { success: true, script: rowToScript(row) };
  } catch (error) {
    dbLog.error('failed to save script', { error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}

export async function deleteScript(projectPath: string, scriptId: string): Promise<{ success: boolean }> {
  try {
    const { scriptRepo: sr } = repos();
    sr.delete(projectPath, scriptId);
    return { success: true };
  } catch (error) {
    dbLog.error('failed to delete script', { error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}

export async function reorderScripts(projectPath: string, scriptIds: string[]): Promise<{ success: boolean }> {
  try {
    const { scriptRepo: sr } = repos();
    sr.reorder(projectPath, scriptIds);
    return { success: true };
  } catch (error) {
    dbLog.error('failed to reorder scripts', { error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}
