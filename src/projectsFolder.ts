/**
 * Projects folder setting and the operations built on it: where new projects
 * are created, scanning a folder for sibling repos to add, and changing the
 * setting with the user's chosen handling of projects in the old folder.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { getGlobalSetting, setGlobalSetting, getAllProjects } from './db';
import { renameProjectPath } from './services/projectPathRename';
import type {
  SiblingScanResult,
  AffectedProject,
  ProjectsFolderChangePlan,
  ProjectsFolderChangeAction,
  ApplyProjectsFolderChangeResult,
} from './types';
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

  try {
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    const registered = new Set((await getAllProjects()).map((p) => p.path));
    const candidates = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(parentDir, entry.name))
      .filter((candidate) => candidate !== folderPath && !registered.has(candidate));
    const siblings = (
      await Promise.all(
        candidates.map(async (candidate) => {
          try {
            // `.git` is a directory in normal repos and a file in worktrees/submodules.
            await fs.access(path.join(candidate, '.git'));
            return candidate;
          } catch {
            return null;
          }
        }),
      )
    ).filter((candidate): candidate is string => candidate !== null);
    siblings.sort((a, b) => a.localeCompare(b));
    return { parentDir, siblings };
  } catch (error) {
    projectsFolderLog.warn('sibling scan failed', {
      parentDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return { parentDir, siblings: [] };
  }
}

/** Registered projects living directly in the given folder. */
async function projectsInFolder(folder: string, activeProjectPaths: Set<string>): Promise<AffectedProject[]> {
  const projects = await getAllProjects();
  return projects
    .filter((p) => path.dirname(p.path) === folder)
    .map((p) => ({ path: p.path, name: p.name, hasActiveSessions: activeProjectPaths.has(p.path) }));
}

/**
 * First half of changing the projects folder setting: validates the new
 * folder and reports the projects living in the current one. When none are
 * affected the setting commits immediately; otherwise the caller shows the
 * move/forget/keep dialog and follows up with applyProjectsFolderChange.
 */
export async function prepareProjectsFolderChange(
  newFolder: string,
  activeProjectPaths: Set<string>,
): Promise<ProjectsFolderChangePlan> {
  if (!path.isAbsolute(newFolder)) {
    return { status: 'invalid', error: 'The projects folder must be an absolute path', affected: [] };
  }
  const currentFolder = await getDefaultProjectsDir();
  if (newFolder === currentFolder) return { status: 'unchanged', affected: [] };

  const affected = await projectsInFolder(currentFolder, activeProjectPaths);
  if (affected.length === 0) {
    await setDefaultProjectsDir(newFolder);
    return { status: 'committed', affected: [] };
  }
  return { status: 'needs-decision', affected };
}

export interface ApplyProjectsFolderChangeOptions {
  /** Paths of projects with running terminal sessions; these refuse to move. */
  activeProjectPaths: Set<string>;
  /** Unregisters one project, including any per-project cleanup (sandbox VM, config). */
  removeProject: (projectPath: string) => Promise<void>;
}

/**
 * Second half of changing the projects folder: carries out the user's chosen
 * action for the affected projects, then commits the setting. A 'move' only
 * commits when every project relocated; failures leave the setting on the old
 * folder so the change can be fixed and retried.
 */
export async function applyProjectsFolderChange(
  newFolder: string,
  action: ProjectsFolderChangeAction,
  options: ApplyProjectsFolderChangeOptions,
): Promise<ApplyProjectsFolderChangeResult> {
  const currentFolder = await getDefaultProjectsDir();
  const affected = await projectsInFolder(currentFolder, options.activeProjectPaths);

  if (action === 'move') {
    const blocked = affected.filter((p) => p.hasActiveSessions);
    const movable = affected.filter((p) => !p.hasActiveSessions);
    const result = await moveProjects(
      movable.map((p) => p.path),
      newFolder,
    );
    const failed = [
      ...blocked.map((p) => ({ path: p.path, error: 'Close its running terminal sessions first' })),
      ...result.failed,
    ];
    const committed = failed.length === 0;
    if (committed) await setDefaultProjectsDir(newFolder);
    return { committed, moved: result.moved, failed };
  }

  if (action === 'forget') {
    const failed: { path: string; error: string }[] = [];
    await Promise.all(
      affected.map(async (p) => {
        try {
          await options.removeProject(p.path);
        } catch (error) {
          failed.push({ path: p.path, error: error instanceof Error ? error.message : String(error) });
        }
      }),
    );
    await setDefaultProjectsDir(newFolder);
    return { committed: true, moved: [], failed };
  }

  await setDefaultProjectsDir(newFolder);
  return { committed: true, moved: [], failed: [] };
}

/**
 * Moves registered projects into a new folder: renames each directory on
 * disk, then migrates everything keyed by the old path (database rows,
 * settings, sandbox config, worktree links) via renameProjectPath.
 * Each project is independent — one failure doesn't stop the rest.
 */
export async function moveProjects(
  projectPaths: string[],
  newFolder: string,
): Promise<{ moved: { from: string; to: string }[]; failed: { path: string; error: string }[] }> {
  const moved: { from: string; to: string }[] = [];
  const failed: { path: string; error: string }[] = [];
  const failAll = (error: string) => ({ moved, failed: projectPaths.map((p) => ({ path: p, error })) });

  if (!path.isAbsolute(newFolder)) {
    return failAll('The new folder must be an absolute path');
  }
  // Renaming a directory into its own subtree fails (and mkdir would leave a
  // stray folder inside the repo), so reject before touching the disk.
  for (const projectPath of projectPaths) {
    if (newFolder === projectPath || newFolder.startsWith(projectPath + path.sep)) {
      return failAll(`The new folder is inside "${path.basename(projectPath)}"`);
    }
  }

  try {
    await fs.mkdir(newFolder, { recursive: true });
  } catch (error) {
    return failAll(error instanceof Error ? error.message : String(error));
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
          ? 'Cannot move across disks. Pick a folder on the same volume.'
          : error instanceof Error
            ? error.message
            : String(error);
      failed.push({ path: projectPath, error: message });
      continue;
    }

    try {
      await renameProjectPath(projectPath, target);
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

    moved.push({ from: projectPath, to: target });
    projectsFolderLog.info('moved project', { from: projectPath, to: target });
  }

  return { moved, failed };
}
