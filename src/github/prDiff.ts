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
import { fetchRefspec, resolveRef, getRangeDiffFiles, getRangeFileDiff } from '../git';
import { getLogger } from '../logger';
import type { ChangedFile, FileDiff } from '../types';

const execFileAsync = promisify(execFile);

const diffLog = getLogger().scope('github:diff');

/** How much history to pull in when a shallow clone can't reach the merge base. */
const DEEPEN_COMMITS = 250;

export function prHeadRef(prNumber: number): string {
  return `refs/ouijit/pr/${prNumber}`;
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
export async function ensurePrRefs(
  projectPath: string,
  prNumber: number,
  baseSha: string,
  headSha: string,
  remote = 'origin',
): Promise<PrRefsResult> {
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
    await pinRef(projectPath, prBaseRef(prNumber), baseSha);
  }

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
): Promise<FileDiff | null> {
  const refs = await ensurePrRefs(projectPath, prNumber, baseSha, headSha);
  if (!refs.success) return null;
  return getRangeFileDiff(projectPath, baseSha, headSha, filePath, contextLines);
}

/**
 * Drop the refs we fetched for a PR. Called when a PR is unlinked or merged, so
 * a long-lived project doesn't accumulate a ref per PR ever reviewed.
 */
export async function prunePrRefs(projectPath: string, prNumber: number): Promise<void> {
  for (const ref of [prHeadRef(prNumber), prBaseRef(prNumber)]) {
    await tryGit(projectPath, ['update-ref', '-d', ref]);
  }
}
