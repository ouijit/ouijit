/**
 * Projects folder setting and the operations built on it: where new projects
 * are created, scanning a folder for sibling repos to add, and physically
 * moving registered projects when the user changes the setting.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { getGlobalSetting, setGlobalSetting, getAllProjects, updateProjectPath } from './db';
import type { SiblingScanResult, RelocateProjectsResult } from './types';
import { getLogger } from './logger';

const projectsFolderLog = getLogger().scope('projectsFolder');

/** Global-settings key holding the user's chosen projects folder. */
export const PROJECTS_FOLDER_KEY = 'projects:folder';

/** Built-in default used until the user picks a folder. */
export function getFallbackProjectsDir(): string {
  return path.join(os.homedir(), 'Ouijit', 'projects');
}

/** The folder new projects are created in: the setting if set, else the built-in default. */
export async function getDefaultProjectsDir(): Promise<string> {
  const configured = await getGlobalSetting(PROJECTS_FOLDER_KEY);
  if (configured && path.isAbsolute(configured)) return configured;
  return getFallbackProjectsDir();
}

/** Persist a folder as the default for future project creation. */
export async function setDefaultProjectsDir(folderPath: string): Promise<void> {
  await setGlobalSetting(PROJECTS_FOLDER_KEY, folderPath);
}

/**
 * Scans the parent directory of a just-added project for sibling git repos
 * that aren't registered yet — the Obsidian-vault-style "you opened one
 * project from a folder full of projects" detection.
 */
export async function scanSiblingProjects(folderPath: string): Promise<SiblingScanResult> {
  const parentDir = path.dirname(folderPath);
  // At the filesystem root dirname() returns the path itself — nothing to scan.
  if (parentDir === folderPath) return { parentDir, siblings: [] };

  let entries;
  try {
    entries = await fs.readdir(parentDir, { withFileTypes: true });
  } catch (error) {
    projectsFolderLog.warn('sibling scan failed to read parent directory', {
      parentDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return { parentDir, siblings: [] };
  }

  const registered = new Set((await getAllProjects()).map((p) => p.path));
  const siblings: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const candidate = path.join(parentDir, entry.name);
    if (candidate === folderPath || registered.has(candidate)) continue;
    try {
      // `.git` is a directory in normal repos and a file in worktrees/submodules.
      await fs.access(path.join(candidate, '.git'));
    } catch {
      continue;
    }
    siblings.push(candidate);
  }
  siblings.sort((a, b) => a.localeCompare(b));
  return { parentDir, siblings };
}

/**
 * Moves registered projects into a new folder: renames the directory on disk,
 * rewrites every stored path in the database, and repairs git worktree links
 * (the linked worktrees' `.git` files point at the main repo's old location).
 * Each project is independent — one failure doesn't stop the rest.
 */
export async function moveProjects(projectPaths: string[], newFolder: string): Promise<RelocateProjectsResult> {
  const moved: { from: string; to: string }[] = [];
  const failed: { path: string; error: string }[] = [];

  try {
    await fs.mkdir(newFolder, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, moved, failed: projectPaths.map((p) => ({ path: p, error: message })) };
  }

  const registered = new Set((await getAllProjects()).map((p) => p.path));

  for (const projectPath of projectPaths) {
    if (!registered.has(projectPath)) {
      failed.push({ path: projectPath, error: 'Not a registered project' });
      continue;
    }
    const target = path.join(newFolder, path.basename(projectPath));
    if (target === projectPath) continue;

    try {
      await fs.access(target);
      failed.push({ path: projectPath, error: `A folder named "${path.basename(projectPath)}" already exists there` });
      continue;
    } catch {
      // Target doesn't exist — clear to move.
    }

    try {
      await fs.rename(projectPath, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const message =
        code === 'EXDEV'
          ? 'Cannot move across disks — pick a folder on the same volume'
          : error instanceof Error
            ? error.message
            : String(error);
      failed.push({ path: projectPath, error: message });
      continue;
    }

    try {
      await updateProjectPath(projectPath, target);
    } catch (error) {
      // The directory moved but the database still points at the old path —
      // move it back so disk and registry stay consistent.
      const message = error instanceof Error ? error.message : String(error);
      projectsFolderLog.error('database update failed after move, rolling back', {
        projectPath,
        target,
        error: message,
      });
      try {
        await fs.rename(target, projectPath);
      } catch (rollbackError) {
        projectsFolderLog.error('rollback rename failed', {
          target,
          projectPath,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
      failed.push({ path: projectPath, error: message });
      continue;
    }

    // Best-effort: linked worktrees still point at the old main-repo path.
    try {
      execSync('git worktree repair', { cwd: target, stdio: 'ignore' });
    } catch (error) {
      projectsFolderLog.warn('git worktree repair failed after move', {
        target,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    moved.push({ from: projectPath, to: target });
    projectsFolderLog.info('moved project', { from: projectPath, to: target });
  }

  return { success: failed.length === 0, moved, failed };
}
