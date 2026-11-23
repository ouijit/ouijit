import * as fs from 'node:fs';
import * as path from 'node:path';
import { execGit, execGitSync, mainGitDirOf } from './gitCommand';

/** The branch a task merges into and its remote-tracking refs, by full ref name, with the SHA each points at. */
export async function snapshotProtectedRefs(projectPath: string, mergeTarget: string): Promise<Record<string, string>> {
  const { stdout } = await execGit(
    ['for-each-ref', '--format=%(refname) %(objectname)', `refs/heads/${mergeTarget}`, `refs/remotes/*/${mergeTarget}`],
    projectPath,
  );
  const ownRef = (ref: string) =>
    ref === `refs/heads/${mergeTarget}` || (ref.startsWith('refs/remotes/') && ref.endsWith(`/${mergeTarget}`));
  const refs: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const [ref, sha] = line.split(' ');
    if (ref && sha && ownRef(ref)) refs[ref] = sha;
  }
  return refs;
}

/**
 * The recorded refs that have since moved other than through git on the host.
 * Every move git makes appends its old and new SHA to the ref's reflog, which a
 * sandbox cannot write, so the SHAs git has moved a ref to from the recorded
 * one, entry by entry, are the ones it may point at. A ref since deleted
 * protects nothing and is not reported.
 */
export function refsMovedOutsideGit(projectPath: string, recorded: Record<string, string>): string[] {
  const commonDir = mainGitDirOf(projectPath);
  if (!commonDir) return [];
  return Object.entries(recorded)
    .filter(([ref, from]) => {
      let tip: string;
      try {
        tip = execGitSync(['rev-parse', '--verify', '--quiet', ref], projectPath).trim();
      } catch {
        return false;
      }
      return tip !== from && !reachedByGit(path.join(commonDir, 'logs', ref), from, tip);
    })
    .map(([ref]) => ref);
}

function reachedByGit(reflog: string, from: string, tip: string): boolean {
  let entries: string[];
  try {
    entries = fs.readFileSync(reflog, 'utf8').split('\n').filter(Boolean);
  } catch {
    return false;
  }
  const reached = new Set([from]);
  for (const entry of entries) {
    const [oldSha, newSha] = entry.split(' ');
    if (reached.has(oldSha)) reached.add(newSha);
  }
  return reached.has(tip);
}
