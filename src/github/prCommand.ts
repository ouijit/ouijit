/**
 * Running a named command with a pull request's context.
 *
 * Two modes share this module because they share everything except what
 * happens to the output. A `lens` reads the changed-file list on stdin and
 * writes grouping JSON on stdout, and its result regroups the diff. A
 * `terminal` command is handed to a terminal instead, so only its environment
 * comes from here.
 *
 * Nothing in this file decides how a pull request should be read. The whole
 * point is that the ordering, the naming, and any judgement live in a command
 * the user owns — a shell one-liner over globs, or an agent CLI. What is fixed
 * here is the contract and the safety rule: a lens may reorder and group, but
 * it may never hide a changed file.
 */

import { spawn } from 'node:child_process';
import type { PrCommandRow } from '../db';
import { getLogger } from '../logger';
import type { PullRequestDetail, PullRequestFile } from './types';

const lensLog = getLogger().scope('github:lens');

/**
 * Sixty seconds, not the hook runner's five minutes. This runs because someone
 * pressed a button and is waiting on the result, so a hang has to fail while
 * they are still looking at it.
 */
const LENS_TIMEOUT_MS = 60_000;
const SIGKILL_GRACE = 5_000;
const MAX_OUTPUT = 1_000_000;

export interface LensGroup {
  title: string;
  summary?: string;
  paths: string[];
}

/**
 * Same `{ success, error? }` shape as every other result in this codebase.
 * A discriminated union would read better, but `strictNullChecks` is off here
 * so `ok: true | false` never narrows — this is the shape that actually works.
 */
export interface LensResult {
  success: boolean;
  groups?: LensGroup[];
  error?: string;
}

/** The environment both modes get. A terminal command receives the same names. */
export function prCommandEnv(detail: PullRequestDetail, worktreePath?: string): Record<string, string> {
  return {
    OUIJIT_PR_NUMBER: String(detail.number),
    OUIJIT_PR_BRANCH: detail.headRefName,
    OUIJIT_PR_URL: detail.url,
    OUIJIT_PR_TITLE: detail.title,
    ...(worktreePath ? { OUIJIT_WORKTREE_PATH: worktreePath } : {}),
  };
}

interface LensInput {
  prNumber: number;
  title: string;
  baseRefName: string;
  headRefName: string;
  files: { path: string; status: string; additions: number; deletions: number }[];
}

function buildInput(detail: PullRequestDetail, files: PullRequestFile[]): LensInput {
  return {
    prNumber: detail.number,
    title: detail.title,
    baseRefName: detail.baseRefName,
    headRefName: detail.headRefName,
    files: files.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };
}

/**
 * Pull `{ groups: [...] }` out of stdout.
 *
 * Strict parse first. Plenty of CLIs print a banner or a progress line before
 * their answer, so a failed parse falls back to the last balanced object in the
 * stream rather than rejecting output that is really there.
 */
function parseGroups(stdout: string): LensGroup[] | null {
  const attempt = (text: string): LensGroup[] | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const groups = (parsed as { groups?: unknown }).groups;
      if (!Array.isArray(groups)) return null;
      const clean: LensGroup[] = [];
      for (const group of groups) {
        if (typeof group !== 'object' || group === null) continue;
        const { title, summary, paths } = group as Record<string, unknown>;
        if (typeof title !== 'string' || !Array.isArray(paths)) continue;
        clean.push({
          title,
          ...(typeof summary === 'string' ? { summary } : {}),
          paths: paths.filter((p): p is string => typeof p === 'string'),
        });
      }
      return clean;
    } catch {
      return null;
    }
  };

  const trimmed = stdout.trim();
  const direct = attempt(trimmed);
  if (direct) return direct;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return attempt(trimmed.slice(start, end + 1));
}

/**
 * Apply a lens's grouping to the real file list.
 *
 * The safety rule lives here rather than in the renderer, so every caller gets
 * it: a path the lens invented is dropped, a path it listed twice appears once,
 * and every changed file it forgot lands in a trailing group. Missing a changed
 * file because a command did not mention it would be a review that silently
 * skipped code.
 */
export function reconcileGroups(groups: LensGroup[], files: PullRequestFile[]): LensGroup[] {
  const known = new Set(files.map((f) => f.path));
  const placed = new Set<string>();
  const out: LensGroup[] = [];

  for (const group of groups) {
    const paths = group.paths.filter((p) => known.has(p) && !placed.has(p));
    paths.forEach((p) => placed.add(p));
    if (paths.length > 0) out.push({ ...group, paths });
  }

  const rest = files.map((f) => f.path).filter((p) => !placed.has(p));
  if (rest.length > 0) out.push({ title: 'Everything else', paths: rest });
  return out;
}

export function runLens(
  command: PrCommandRow,
  projectPath: string,
  detail: PullRequestDetail,
  files: PullRequestFile[],
): Promise<LensResult> {
  return new Promise((resolve) => {
    const child = spawn(command.command, [], {
      cwd: projectPath,
      env: { ...process.env, ...prCommandEnv(detail) },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: LensResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      }, SIGKILL_GRACE);
      lensLog.warn('lens timed out', { name: command.name });
      finish({ success: false, error: `“${command.name}” took longer than ${LENS_TIMEOUT_MS / 1000}s` });
    }, LENS_TIMEOUT_MS);

    // A lens that never reads stdin leaves this write unconsumed, and the pipe
    // closing under us raises EPIPE. That is a command choosing not to read its
    // input, not an error — swallow it, or every lens written as a plain glob
    // script would fail.
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(buildInput(detail, files)));

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
    });

    child.on('error', (error) => finish({ success: false, error: error.message }));

    child.on('close', (code) => {
      if (code !== 0) {
        // stderr is the only way someone debugs their own lens, so it is what
        // the failure says — not "exited 1".
        const detailText = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        finish({ success: false, error: detailText || `“${command.name}” exited ${code}` });
        return;
      }
      const groups = parseGroups(stdout);
      if (!groups) {
        const detailText = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        finish({
          success: false,
          error: detailText || `“${command.name}” did not print { "groups": [...] }`,
        });
        return;
      }
      finish({ success: true, groups: reconcileGroups(groups, files) });
    });
  });
}
