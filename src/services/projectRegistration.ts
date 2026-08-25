/**
 * Registration orchestration shared by the add-existing, create-new and
 * clone-from-GitHub flows. The latter two are "produce the folder, then run
 * the exact add-existing pipeline", so there is one registration codepath.
 * Kept out of the IPC handlers so the wiring is unit-testable.
 */

import * as path from 'node:path';
import { addProject } from '../db';
import { createProject, validateProjectFolder } from '../projectCreator';
import { setDefaultProjectsDir } from '../projectsFolder';
import { recordFirstProjectIfNeeded } from '../onboarding';
import type {
  CreateProjectOptions,
  CreateProjectResult,
  FirstProjectSource,
  ValidateFolderFailureReason,
} from '../types';

export interface AddExistingProjectResult {
  success: boolean;
  error?: string;
  reason?: ValidateFolderFailureReason;
}

/** Validate and register a git repo as a project, recording onboarding state. */
export async function addExistingProject(
  folderPath: string,
  source: FirstProjectSource = 'added',
): Promise<AddExistingProjectResult> {
  const validation = await validateProjectFolder(folderPath);
  if (validation.ok === false) return { success: false, error: validation.error, reason: validation.reason };
  try {
    await addProject(folderPath);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
  await recordFirstProjectIfNeeded(folderPath, source);
  return { success: true };
}

/**
 * Register a folder some flow has just produced, and make the folder it landed
 * in the default for the next one.
 */
export async function registerProducedProject(
  projectPath: string,
  source: FirstProjectSource,
): Promise<{ success: true } | { success: false; error: string }> {
  const added = await addExistingProject(projectPath, source);
  if (!added.success) {
    return {
      success: false,
      error: `${projectPath} is on disk, but registering it as a project failed: ${added.error}`,
    };
  }
  await setDefaultProjectsDir(path.dirname(projectPath));
  return { success: true };
}

/** Scaffold a new project folder, then register it through the add-existing pipeline. */
export async function createAndRegisterProject(options: CreateProjectOptions): Promise<CreateProjectResult> {
  const result = await createProject(options);
  if (!result.success || !result.projectPath) return result;

  const registered = await registerProducedProject(result.projectPath, 'created');
  if (registered.success === false) return registered;
  return result;
}
