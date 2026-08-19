/**
 * PR diffs, read from the local object database.
 *
 * GitHub computes a PR's diff as `base...head`, the same as
 * `git diff <baseSha>...<headSha>`, so the line numbers `parseDiff()` emits are
 * valid `line` + `side` anchors — but only when pinned to the SHAs the API
 * reports, not to branch names.
 *
 * The API's `patch` field is unused: it is absent for large files and for PRs
 * past 3000 files, and its context cannot be expanded past the hunk.
 *
 * Fetched refs land under `refs/ouijit/pr/<n>`, so they stay prunable and out
 * of the branch list.
 */

import { fetchRefspec, resolveRef, getRangeDiffFiles, getRangeFileDiff, readBlob, gitAsync } from '../git';
import { getLogger } from '../logger';
import { describeError } from '../utils/describeError';
import type { ChangedFile, FileDiff } from '../types';
import type { PrFileVersions } from './types';

const diffLog = getLogger().scope('github:diff');

/** How much history to pull in when a shallow clone can't reach the merge base. */
const DEEPEN_COMMITS = 250;

/**
 * Siblings under the PR's directory, not one nested in the other: git's ref
 * store is a filesystem, so a ref at `refs/ouijit/pr/12` is a file where
 * `refs/ouijit/pr/12/base` needs a directory.
 */
export function prHeadRef(prNumber: number): string {
  return `refs/ouijit/pr/${prNumber}/head`;
}

export function prBaseRef(prNumber: number): string {
  return `refs/ouijit/pr/${prNumber}/base`;
}

export interface PrRefsResult {
  success: boolean;
  error?: string;
}

async function isShallow(projectPath: string): Promise<boolean> {
  try {
    return (await gitAsync(['rev-parse', '--is-shallow-repository'], projectPath)) === 'true';
  } catch {
    return false;
  }
}

async function hasMergeBase(projectPath: string, baseSha: string, headSha: string): Promise<boolean> {
  try {
    await gitAsync(['merge-base', baseSha, headSha], projectPath);
    return true;
  } catch {
    return false;
  }
}

/** Pin a fetched SHA under our namespace so it survives `git gc`. */
async function pinRef(projectPath: string, ref: string, sha: string): Promise<void> {
  // A missing pin only costs a re-fetch later; not worth failing the diff over.
  await tryGit(projectPath, ['update-ref', ref, sha]);
}

/** For git commands whose failure is not worth reporting: every caller
 *  re-checks the condition it cared about. */
async function tryGit(projectPath: string, args: string[]): Promise<void> {
  try {
    await gitAsync(args, projectPath, 32 * 1024 * 1024);
  } catch {
    // Swallowed by design.
  }
}

/**
 * Fetches whichever of a PR's two SHAs are missing locally. The head comes from
 * `refs/pull/<n>/head`, which GitHub exposes even when the fork's branch is
 * gone; the base is fetched by SHA and pinned, since it is often no longer the
 * base branch's tip.
 */
export function ensurePrRefs(
  projectPath: string,
  prNumber: number,
  baseSha: string,
  headSha: string,
  remote = 'origin',
): Promise<PrRefsResult> {
  const key = refsKey(projectPath, prNumber, baseSha, headSha);
  const existing = settledRefs.get(key);
  if (existing) return existing;

  const run = fetchPrRefs(projectPath, prNumber, baseSha, headSha, remote);
  settledRefs.set(key, run);
  void run
    .then((result) => {
      // Only failures are retried: on success the SHAs are pinned under our own
      // refs, and nothing but `prunePrRefs` removes them.
      if (!result.success && settledRefs.get(key) === run) settledRefs.delete(key);
    })
    .catch(() => settledRefs.delete(key));
  return run;
}

/**
 * One fetch per pull request. The files view loads ten diffs at a time and each
 * needs the refs, so without this a PR's first open starts ten identical
 * fetches. Keyed by both SHAs, so a force-push asks again.
 */
const settledRefs = new Map<string, Promise<PrRefsResult>>();

function refsKey(projectPath: string, prNumber: number, baseSha: string, headSha: string): string {
  return `${projectPath} ${prNumber} ${baseSha} ${headSha}`;
}

/** Forget that a PR's refs were ever fetched, so the next read fetches again. */
function forgetRefs(projectPath: string, prNumber: number): void {
  const prefix = `${projectPath} ${prNumber} `;
  for (const key of settledRefs.keys()) {
    if (key.startsWith(prefix)) settledRefs.delete(key);
  }
}

async function fetchPrRefs(
  projectPath: string,
  prNumber: number,
  baseSha: string,
  headSha: string,
  remote: string,
): Promise<PrRefsResult> {
  // An install that fetched under the old flat layout has a ref *file* at
  // `refs/ouijit/pr/<n>`, which blocks creating the directory the sibling refs
  // need — both the fetch below and the pins further down. Dropping it is a
  // no-op everywhere else.
  await tryGit(projectPath, ['update-ref', '-d', `refs/ouijit/pr/${prNumber}`]);

  const needHead = !(await resolveRef(projectPath, headSha));
  if (needHead) {
    const result = await fetchRefspec(projectPath, remote, `+refs/pull/${prNumber}/head:${prHeadRef(prNumber)}`);
    if (!result.success) {
      return { success: false, error: `Could not fetch pull request #${prNumber}: ${result.error ?? 'fetch failed'}` };
    }
    // `refs/pull/<n>/head` is whatever the PR points at now, not necessarily
    // the head the caller read. Unchecked, a force-push mid-read falls through
    // to the merge-base test and is misreported as a shallow clone.
    if (!(await resolveRef(projectPath, headSha))) {
      return {
        success: false,
        error: `Pull request #${prNumber} has moved since it was read — refresh it and try again.`,
      };
    }
  }

  const needBase = !(await resolveRef(projectPath, baseSha));
  if (needBase) {
    const result = await fetchRefspec(projectPath, remote, baseSha);
    if (!result.success) {
      return {
        success: false,
        error: `Could not fetch the base commit ${baseSha.slice(0, 7)}: ${result.error ?? ''}`.trim(),
      };
    }
  }

  // Pinned whether or not this call fetched them: a commit in the object store
  // is not necessarily reachable from anything durable, so skipping the pin
  // lets `git gc` prune it. `update-ref` is idempotent.
  await pinRef(projectPath, prHeadRef(prNumber), headSha);
  await pinRef(projectPath, prBaseRef(prNumber), baseSha);

  // A shallow clone can hold both endpoints without the merge base that
  // `base...head` diffs from. Deepen by a bounded amount rather than
  // `--unshallow`, on a repo the user deliberately kept small.
  if (!(await hasMergeBase(projectPath, baseSha, headSha))) {
    if (await isShallow(projectPath)) {
      diffLog.info('deepening shallow clone for PR diff', { prNumber, deepen: DEEPEN_COMMITS });
      await tryGit(projectPath, ['fetch', `--deepen=${DEEPEN_COMMITS}`, remote]);
    }
    if (!(await hasMergeBase(projectPath, baseSha, headSha))) {
      return {
        success: false,
        error:
          'This clone does not contain enough history to diff the pull request. ' +
          'Run `git fetch --unshallow` in the project and try again.',
      };
    }
  }

  return { success: true };
}

export interface PrDiffFilesResult {
  success: boolean;
  error?: string;
  files?: ChangedFile[];
}

/**
 * Changed files straight from git: the fallback when the API file list is
 * unavailable, and the source of the diff bytes either way.
 */
export async function getPrDiffFiles(
  projectPath: string,
  prNumber: number,
  baseSha: string,
  headSha: string,
): Promise<PrDiffFilesResult> {
  const refs = await ensurePrRefs(projectPath, prNumber, baseSha, headSha);
  if (!refs.success) return { success: false, error: refs.error };

  const files = await getRangeDiffFiles(projectPath, baseSha, headSha);
  if (!files) return { success: false, error: 'Could not read the pull request diff' };
  return { success: true, files };
}

/**
 * One file's hunks. Reading the blobs rather than a patch means `contextLines`
 * can expand past what a GitHub patch would carry.
 */
export async function getPrFileDiff(
  projectPath: string,
  prNumber: number,
  baseSha: string,
  headSha: string,
  filePath: string,
  contextLines?: number,
  oldPath?: string,
): Promise<FileDiff | null> {
  const refs = await ensurePrRefs(projectPath, prNumber, baseSha, headSha);
  if (!refs.success) return null;
  return getRangeFileDiff(projectPath, baseSha, headSha, filePath, contextLines, oldPath);
}

/**
 * Puts the pull request's head on a local branch, ready to check out.
 * `git worktree add -b <name>` branches off HEAD, so a head branch name alone
 * yields an empty branch for every fork PR.
 *
 * The branch takes the PR's head branch name when free, and is qualified with
 * the PR number when taken, rather than moving a branch the user has.
 */
export async function createPrHeadBranch(
  projectPath: string,
  prNumber: number,
  baseSha: string,
  headSha: string,
  headRefName: string,
): Promise<{ success: boolean; branch?: string; error?: string }> {
  const refs = await ensurePrRefs(projectPath, prNumber, baseSha, headSha);
  if (!refs.success) return { success: false, error: refs.error };

  const existing = await resolveRef(projectPath, `refs/heads/${headRefName}`);
  if (existing === headSha) return { success: true, branch: headRefName };

  const branch = existing ? `pr-${prNumber}/${headRefName}` : headRefName;
  const taken = await resolveRef(projectPath, `refs/heads/${branch}`);
  if (taken === headSha) return { success: true, branch };

  try {
    // Never force: a qualified name that already points somewhere else means a
    // previous checkout of this PR is still in use.
    await gitAsync(['branch', branch, headSha], projectPath);
    return { success: true, branch };
  } catch (error) {
    const message = describeError(error);
    return { success: false, error: `Could not create a branch for #${prNumber}: ${message.split('\n')[0]}` };
  }
}

/**
 * How much of a binary file is base64'd across the IPC boundary. Past this the
 * viewer reports the size instead.
 */
const MAX_INLINE_BLOB_BYTES = 12 * 1024 * 1024;

/**
 * Both sides of a binary file. The base side is looked up under `oldPath` when
 * there is one, or a renamed image reads as deleted and added.
 */
export async function getPrFileVersions(
  projectPath: string,
  prNumber: number,
  baseSha: string,
  headSha: string,
  filePath: string,
  oldPath?: string,
): Promise<PrFileVersions> {
  const refs = await ensurePrRefs(projectPath, prNumber, baseSha, headSha);
  if (!refs.success) return { before: null, after: null };

  const [before, after] = await Promise.all([
    readBlob(projectPath, baseSha, oldPath ?? filePath, MAX_INLINE_BLOB_BYTES),
    readBlob(projectPath, headSha, filePath, MAX_INLINE_BLOB_BYTES),
  ]);
  return { before, after };
}

/**
 * Drop the refs we fetched for a PR, so a long-lived project doesn't accumulate
 * a ref per PR ever reviewed.
 */
export async function prunePrRefs(projectPath: string, prNumber: number): Promise<void> {
  forgetRefs(projectPath, prNumber);
  for (const ref of [prHeadRef(prNumber), prBaseRef(prNumber), `refs/ouijit/pr/${prNumber}`]) {
    // The last one is the pre-sibling layout's head ref, dropped so an install
    // that fetched under the old scheme doesn't keep it forever.
    await tryGit(projectPath, ['update-ref', '-d', ref]);
  }
}
