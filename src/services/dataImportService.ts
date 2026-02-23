/**
 * One-shot migration from JSON files to SQLite.
 * Reads old JSON files, populates the DB, writes a marker file.
 * Runs once during app.whenReady() — subsequent launches skip via marker check.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { app } from 'electron';
import type { ProjectRepo } from '../db/repos/projectRepo';
import type { TaskRepo, TaskStatus } from '../db/repos/taskRepo';
import type { SettingsRepo } from '../db/repos/settingsRepo';
import type { HookRepo, HookType } from '../db/repos/hookRepo';
import type Database from 'better-sqlite3';
import log from '../log';

const migrationLog = log.scope('migration');

interface OldTaskMetadata {
  taskNumber: number;
  branch?: string;
  name: string;
  status: string;
  createdAt: string;
  closedAt?: string;
  worktreePath?: string;
  mergeTarget?: string;
  prompt?: string;
  sandboxed?: boolean;
  order?: number;
  readyToShip?: boolean;
}

interface OldProjectData {
  nextTaskNumber: number;
  tasks: OldTaskMetadata[];
}

interface OldTaskStore {
  __schemaVersion?: number;
  [projectPath: string]: OldProjectData | number | undefined;
}

interface OldScriptHook {
  id?: string;
  type: string;
  command: string;
  name?: string;
  description?: string;
}

interface OldProjectSettings {
  customCommands?: unknown[];
  hooks?: Record<string, OldScriptHook>;
  sandbox?: { memoryGiB?: number; diskGiB?: number };
  killExistingOnRun?: boolean;
}

interface OldSettingsStore {
  [projectPath: string]: OldProjectSettings;
}

export interface ImportResult {
  projectsImported: number;
  tasksImported: number;
  hooksImported: number;
  settingsImported: number;
  errors: string[];
}

const IMPORT_MARKER = 'data-imported';

function getMarkerPath(): string {
  return path.join(app.getPath('userData'), IMPORT_MARKER);
}

async function hasAlreadyImported(): Promise<boolean> {
  try {
    await fs.access(getMarkerPath());
    return true;
  } catch {
    return false;
  }
}

async function markImported(): Promise<void> {
  await fs.writeFile(getMarkerPath(), new Date().toISOString(), 'utf-8');
}

/** Migrate v0/v1 task statuses to v2 equivalents */
function migrateTaskStatus(task: OldTaskMetadata): TaskStatus {
  if (task.status === 'closed') return 'done';
  if (task.status === 'open' && task.readyToShip) return 'in_review';
  if (task.status === 'open') return 'in_progress';
  // Already v2 status
  const valid: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
  if (valid.includes(task.status as TaskStatus)) return task.status as TaskStatus;
  return 'in_progress'; // fallback
}

export async function importAll(
  db: Database.Database,
  projectRepo: ProjectRepo,
  taskRepo: TaskRepo,
  settingsRepo: SettingsRepo,
  hookRepo: HookRepo,
): Promise<ImportResult> {
  const result: ImportResult = {
    projectsImported: 0,
    tasksImported: 0,
    hooksImported: 0,
    settingsImported: 0,
    errors: [],
  };

  if (await hasAlreadyImported()) {
    return result;
  }

  const userData = app.getPath('userData');

  // Read all JSON files before the transaction (async I/O)
  let addedProjects: string[] = [];
  try {
    const addedProjectsPath = path.join(os.homedir(), 'Ouijit', 'added-projects.json');
    const raw = await fs.readFile(addedProjectsPath, 'utf-8');
    const data = JSON.parse(raw);
    addedProjects = Array.isArray(data.projects) ? data.projects : [];
  } catch {
    // No added-projects.json — skip
  }

  let taskStore: OldTaskStore | null = null;
  try {
    const taskMetaPath = path.join(userData, 'task-metadata.json');
    const raw = await fs.readFile(taskMetaPath, 'utf-8');
    taskStore = JSON.parse(raw) as OldTaskStore;
  } catch {
    // No task-metadata.json — skip
  }

  let settingsStore: OldSettingsStore | null = null;
  try {
    const settingsPath = path.join(userData, 'project-settings.json');
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settingsStore = JSON.parse(raw) as OldSettingsStore;
  } catch {
    // No project-settings.json — skip
  }

  // Run all DB writes in a single transaction (better-sqlite3 is synchronous)
  const doImport = db.transaction(() => {
    // 1. Import projects from added-projects.json
    for (const projectPath of addedProjects) {
      try {
        const name = path.basename(projectPath);
        projectRepo.add(projectPath, name);
        result.projectsImported++;
      } catch (error) {
        result.errors.push(`Project ${projectPath}: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }

    // 2. Import tasks from task-metadata.json
    if (taskStore) {
      for (const [key, value] of Object.entries(taskStore)) {
        if (key === '__schemaVersion' || typeof value !== 'object' || !value) continue;
        const projectData = value as OldProjectData;
        const projectPath = key;

        // Ensure the project exists
        if (!projectRepo.getByPath(projectPath)) {
          const name = path.basename(projectPath);
          projectRepo.add(projectPath, name);
          result.projectsImported++;
        }

        // Update the counter to match the old store
        if (projectData.nextTaskNumber > 1) {
          db.prepare(
            'UPDATE project_counters SET next_task_number = ? WHERE project_path = ?'
          ).run(projectData.nextTaskNumber, projectPath);
        }

        for (const task of projectData.tasks) {
          try {
            const status = migrateTaskStatus(task);
            taskRepo.create(projectPath, task.taskNumber, task.name, {
              status,
              branch: task.branch,
              mergeTarget: task.mergeTarget,
              prompt: task.prompt,
              sandboxed: task.sandboxed,
              worktreePath: task.worktreePath,
              createdAt: task.createdAt,
            });
            // If original had closedAt, preserve it
            if (task.closedAt) {
              db.prepare(
                'UPDATE tasks SET closed_at = ? WHERE project_path = ? AND task_number = ?'
              ).run(task.closedAt, projectPath, task.taskNumber);
            }
            // Preserve original order if present
            if (task.order !== undefined) {
              db.prepare(
                'UPDATE tasks SET sort_order = ? WHERE project_path = ? AND task_number = ?'
              ).run(task.order, projectPath, task.taskNumber);
            }
            result.tasksImported++;
          } catch (error) {
            result.errors.push(`Task ${task.name} in ${projectPath}: ${error instanceof Error ? error.message : 'unknown'}`);
          }
        }
      }
    }

    // 3. Import settings and hooks from project-settings.json
    if (settingsStore) {
      for (const [projectPath, settings] of Object.entries(settingsStore)) {
        try {
          // Ensure the project exists
          if (!projectRepo.getByPath(projectPath)) {
            const name = path.basename(projectPath);
            projectRepo.add(projectPath, name);
            result.projectsImported++;
          }

          // Import sandbox settings
          const updates: Partial<{ kill_existing_on_run: number; sandbox_memory_gib: number; sandbox_disk_gib: number }> = {};
          if (settings.sandbox?.memoryGiB) updates.sandbox_memory_gib = settings.sandbox.memoryGiB;
          if (settings.sandbox?.diskGiB) updates.sandbox_disk_gib = settings.sandbox.diskGiB;
          if (settings.killExistingOnRun !== undefined) updates.kill_existing_on_run = settings.killExistingOnRun ? 1 : 0;

          if (Object.keys(updates).length > 0) {
            settingsRepo.update(projectPath, updates);
            result.settingsImported++;
          }

          // Import hooks
          if (settings.hooks) {
            for (const [hookType, hook] of Object.entries(settings.hooks)) {
              try {
                const validTypes: HookType[] = ['start', 'continue', 'run', 'cleanup', 'sandbox-setup', 'editor'];
                if (validTypes.includes(hookType as HookType) && hook.command) {
                  hookRepo.save(
                    projectPath,
                    hookType as HookType,
                    hook.name || hookType,
                    hook.command,
                    hook.id,
                    hook.description,
                  );
                  result.hooksImported++;
                }
              } catch (error) {
                result.errors.push(`Hook ${hookType} in ${projectPath}: ${error instanceof Error ? error.message : 'unknown'}`);
              }
            }
          }
        } catch (error) {
          result.errors.push(`Settings for ${projectPath}: ${error instanceof Error ? error.message : 'unknown'}`);
        }
      }
    }
  });

  doImport();

  migrationLog.info('import completed', {
    projects: result.projectsImported,
    tasks: result.tasksImported,
    hooks: result.hooksImported,
    settings: result.settingsImported,
    errors: result.errors.length,
  });

  await markImported();
  return result;
}
