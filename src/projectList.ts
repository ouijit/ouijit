import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Project } from './types';
import { getDatabase } from './db/database';
import { ProjectRepo } from './db/repos/projectRepo';

export type { Project };

/**
 * Checks if a path exists
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns all manually-added projects. Reads the added project rows from the DB,
 * filters to those still on disk, and projects each surviving row into a Project
 * built from { name, path, iconColor }.
 */
export async function getProjectList(): Promise<Project[]> {
  const db = getDatabase();
  const projectRepo = new ProjectRepo(db);
  const rows = projectRepo.getAll();

  const projects: Project[] = [];
  for (const row of rows) {
    if (await exists(row.path)) {
      projects.push({
        name: path.basename(row.path),
        path: row.path,
        iconColor: row.icon_color ?? undefined,
      });
    }
  }

  return projects;
}
