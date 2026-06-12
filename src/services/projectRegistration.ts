/**
 * Registration orchestration shared by the create-new and add-existing
 * project flows. Creating a project is "scaffold the folder, then run the
 * exact add-existing pipeline", so there is one registration codepath.
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

/** Scaffold a new project folder, then register it through the add-existing pipeline. */
export async function createAndRegisterProject(options: CreateProjectOptions): Promise<CreateProjectResult> {
  const result = await createProject(options);
  if (!result.success || !result.projectPath) return result;

  const added = await addExistingProject(result.projectPath, 'created');
  if (!added.success) {
    return {
      success: false,
      error: `Project folder created at ${result.projectPath}, but registering it failed: ${added.error}`,
    };
  }
  // The folder this project was created in becomes the default for the next one.
  await setDefaultProjectsDir(path.dirname(result.projectPath));
  return result;
}
