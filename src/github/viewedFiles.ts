import { getGlobalSetting, setGlobalSetting } from '../db';
import { toggleInList } from '../utils/toggleIn';

/**
 * Which files of a pull request the reviewer has finished with.
 *
 * Scoped to a head: a file you read and then someone pushed to is a file you
 * have not read. Clearing the whole set on a new head rather than keeping it
 * per-file is deliberate — the change you approved of in one file can be made
 * wrong by an edit to another, and quietly carrying "done" across a force-push
 * is how a review comes to cover code nobody looked at.
 *
 * Kept in settings rather than a table: two fields per pull request that only
 * this pane reads.
 */
export interface ViewedFiles {
  headSha: string;
  paths: string[];
}

export function viewedFilesKey(projectPath: string, prNumber: number): string {
  return `github:viewed:${projectPath}:${prNumber}`;
}

export async function getViewedFiles(projectPath: string, prNumber: number, headSha: string): Promise<string[]> {
  const raw = await getGlobalSetting(viewedFilesKey(projectPath, prNumber));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const stored = parsed as Partial<ViewedFiles>;
    if (stored.headSha !== headSha || !Array.isArray(stored.paths)) return [];
    return stored.paths.filter((path): path is string => typeof path === 'string');
  } catch {
    return [];
  }
}

export async function setFileViewed(
  projectPath: string,
  prNumber: number,
  headSha: string,
  path: string,
  viewed: boolean,
): Promise<string[]> {
  const current = await getViewedFiles(projectPath, prNumber, headSha);
  const next = toggleInList(current, path, viewed);
  await setGlobalSetting(viewedFilesKey(projectPath, prNumber), JSON.stringify({ headSha, paths: next }));
  return next;
}
