/**
 * PR diffs, read from the local object database.
 *
 * GitHub computes a PR's diff as `base...head`, which is exactly what
 * `git diff <baseSha>...<headSha>` computes — so the line numbers `parseDiff()`
 * already emits are valid `line` + `side` review anchors, provided we pin to
 * the SHAs the API reports rather than to branch names.
 *
 * The API's `patch` field is deliberately not used: it is absent for files past
 * a size threshold and for PRs past 3000 files, and context can never be
 * expanded beyond the hunk. "This file is too large to display" is exactly the
 * moment a user gives up and opens github.com.
 *
 * Fetching a PR head needs no checkout and no worktree. Refs land under
 * `refs/ouijit/pr/<n>` so they stay prunable and never pollute the branch list.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchRefspec, resolveRef, getRangeDiffFiles, getRangeFileDiff, readBlob } from '../git';
import { getLogger } from '../logger';
import type { BlobContent, ChangedFile, FileDiff } from '../types';

const execFileAsync = promisify(execFile);

const diffLog = getLogger().scope('github:diff');

/** How much history to pull in when a shallow clone can't reach the merge base. */
const DEEPEN_COMMITS = 250;

/**
 * The two refs are siblings under the PR's own directory rather than one
 * nested inside the other: git's ref store is a filesystem, so a ref at
 * `refs/ouijit/pr/12` makes `refs/ouijit/pr/12/base` uncreatable — the head is
 * a file where the base needs a directory. Pinning the base failed silently,
 * which left it prunable by `git gc`.
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
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: projectPath,
      encoding: 'utf8',
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function hasMergeBase(projectPath: string, baseSha: string, headSha: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', baseSha, headSha], { cwd: projectPath, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/** Pin a fetched SHA under our namespace so it survives `git gc`. */
async function pinRef(projectPath: string, ref: string, sha: string): Promise<void> {
  try {
    await execFileAsync('git', ['update-ref', ref, sha], { cwd: projectPath, encoding: 'utf8' });
  } catch {
    // A missing pin only costs a re-fetch later; not worth failing the diff over.
  }
}

/** Run a git command whose failure is not worth reporting. */
async function tryGit(projectPath: string, args: string[]): Promise<void> {
  try {
    await execFileAsync('git', args, { cwd: projectPath, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    // Best effort by design — callers re-check the condition they cared about.
  }
}

/**
 * Make sure both SHAs of a PR are present locally, fetching what is missing.
 *
 * The head arrives via `refs/pull/<n>/head`, which every GitHub repo exposes
 * whether or not the fork's branch still exists. The base is fetched by SHA
 * directly — GitHub allows fetching any reachable commit — and pinned, since a
 * base SHA is frequently no longer the base branch's tip.
 */
export function ensurePrRefs(
  projectPath: string,
  prNumber: number,
  baseSha: string,
  headSha: string,
  remote = 'origin',
): Promise<PrRefsResult> {
  const key = `${projectPath} ${prNumber} ${baseSha} ${headSha}`;
  const existing = inflightRefs.get(key);
  if (existing) return existing;

  const run = fetchPrRefs(projectPath, prNumber, baseSha, headSha, remote);
  inflightRefs.set(key, run);
  void run.finally(() => {
    if (inflightRefs.get(key) === run) inflightRefs.delete(key);
  });
  return run;
}

/**
 * One fetch per pull request, not one per file.
 *
 * The files view loads ten diffs at a time and each one needs the refs. On a
 * PR's first open all ten find the head missing and each starts the same
 * `git fetch` — ten network round trips for one ref, and up to three hundred on
 * a large PR. They all succeed, so nothing looks wrong; it is just the same
 * work done again and again. Callers share the first call's promise instead.
 */
const inflightRefs = new Map<string, Promise<PrRefsResult>>();

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

  // Pinned whether or not this call fetched them. A commit already in the
  // object store is not necessarily reachable from anything durable — it can be
  // left over from a FETCH_HEAD, a since-deleted remote branch, or an earlier
  // unpinned fetch — so skipping the pin because the lookup succeeded is what
  // lets `git gc` prune it out from under a repo the user never touched.
  // `update-ref` is idempotent, so the repeat costs nothing.
  await pinRef(projectPath, prHeadRef(prNumber), headSha);
  await pinRef(projectPath, prBaseRef(prNumber), baseSha);

  // A shallow or partial clone can hold both endpoints without holding the
  // commit they share, which is what `base...head` actually diffs against. One
  // bounded deepening pass rather than an unbounded `--unshallow` on a repo the
  // user deliberately kept small.
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
 * Changed files straight from git. Used as the fallback when the API file list
 * is unavailable, and as the source of truth for the diff bytes either way.
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
 * One file's hunks. `contextLines` lets the UI expand context past what a
 * GitHub patch would ever include, because this reads the blobs rather than a
 * pre-rendered patch.
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
 * Put the pull request's head on a local branch, ready to be checked out.
 *
 * `git worktree add -b <name>` branches off whatever HEAD happens to be, so
 * handing a task the PR's head *branch name* and hoping produced an empty
 * branch with none of the PR's commits for every fork PR — and reported
 * success. The commits have to be here first, on a ref a worktree can use.
 *
 * The branch is named after the PR's head branch when that name is free. When
 * it is taken by something else — a fork whose head branch is called `main` is
 * the case that matters — the name is qualified with the PR number rather than
 * moving a branch the user already has.
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
    await execFileAsync('git', ['branch', branch, headSha], { cwd: projectPath, encoding: 'utf8' });
    return { success: true, branch };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Could not create a branch for #${prNumber}: ${message.split('\n')[0]}` };
  }
}

/**
 * How much of a binary file we are willing to base64 across the IPC boundary.
 * Past this the viewer states the size instead, which is the useful fact about
 * a file that large anyway.
 */
const MAX_INLINE_BLOB_BYTES = 12 * 1024 * 1024;

export interface PrFileVersions {
  /** The file as of the base. Null when the pull request adds it. */
  before: BlobContent | null;
  /** The file as of the head. Null when the pull request deletes it. */
  after: BlobContent | null;
}

/**
 * Both sides of a binary file, so an image can be shown before and after.
 *
 * A rename moves the path, so the base side is looked up under `oldPath` when
 * there is one — otherwise a renamed image would read as deleted and added.
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
 * Drop the refs we fetched for a PR. Called when a PR is unlinked or merged, so
 * a long-lived project doesn't accumulate a ref per PR ever reviewed.
 */
export async function prunePrRefs(projectPath: string, prNumber: number): Promise<void> {
  for (const ref of [prHeadRef(prNumber), prBaseRef(prNumber), `refs/ouijit/pr/${prNumber}`]) {
    // The last one is the pre-sibling layout's head ref, dropped so an install
    // that fetched under the old scheme doesn't keep it forever.
    await tryGit(projectPath, ['update-ref', '-d', ref]);
  }
}
