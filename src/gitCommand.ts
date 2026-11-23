import { execFile, execFileSync, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { getTaskHoldingPath } from './db';
import { getUserDataPath } from './paths';

const execFileAsync = promisify(execFile);

/**
 * Settings no repository can override on a host git call. A sandboxed agent
 * writes the worktrees these calls run in, and each of these keys names a
 * program for git to run.
 */
export const HARDENED_GIT_CONFIG = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'core.sshCommand=ssh',
];

/** A project's own `.git` directory, found from the path Ouijit stores for it; null when it has none. */
export function mainGitDirOf(projectPath: string): string | null {
  const dotGit = path.join(projectPath, '.git');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  const out = execFileSync('git', [...HARDENED_GIT_CONFIG, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: projectPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return out || null;
}

const adminDirCache = new Map<string, string>();

/**
 * The directory under `<commonDir>/worktrees` that git made for this worktree.
 * Found by its `gitdir` back-pointer, because the worktree's own `.git` file is
 * the sandbox's to rewrite. A sandbox can rewrite its own entry's `gitdir` too,
 * so two entries claiming one worktree is refused rather than guessed at.
 */
export function worktreeAdminDir(commonDir: string, worktreePath: string): string {
  const root = path.join(commonDir, 'worktrees');
  const real = fs.realpathSync(worktreePath);
  const pointsHere = (id: string): boolean => {
    try {
      const entry = path.join(root, id);
      const target = path.resolve(entry, fs.readFileSync(path.join(entry, 'gitdir'), 'utf8').trim());
      return path.basename(target) === '.git' && fs.realpathSync(path.dirname(target)) === real;
    } catch {
      return false;
    }
  };

  const key = `${root}\0${real}`;
  const cached = adminDirCache.get(key);
  if (cached && pointsHere(path.basename(cached))) return cached;

  // git names the entry after the worktree's folder unless that name was taken.
  const named = path.basename(real);
  const matches = pointsHere(named) ? [named] : fs.readdirSync(root).filter(pointsHere);
  if (matches.length !== 1) {
    throw new Error(`${worktreePath} is not one of the worktrees git has recorded in ${root}`);
  }
  const dir = path.join(root, matches[0]);
  adminDirCache.set(key, dir);
  return dir;
}

interface GitLocation {
  args: string[];
  env?: Record<string, string>;
  /** Carries a HEAD the call moved back to the worktree's own entry. */
  settle?: () => void;
}

/**
 * A git dir Ouijit owns, standing in for a worktree's entry under
 * `.git/worktrees`. The sandbox writes that entry, and git takes its refs from
 * the entry's `commondir` file even when `GIT_COMMON_DIR` says otherwise, so a
 * rewritten `commondir` would show the reviewer another repository's branches.
 * The stand-in carries only what git reads there: `commondir`, fixed here, and
 * a copy of `HEAD`. The index stays the worktree's own, through `GIT_INDEX_FILE`.
 */
function standInGitDir(commonDir: string, adminDir: string): { dir: string; head: string } {
  const dir = path.join(getUserDataPath(), 'git-worktrees', createHash('sha1').update(adminDir).digest('hex'));
  fs.mkdirSync(dir, { recursive: true });
  writeIfChanged(path.join(dir, 'commondir'), `${commonDir}\n`);
  const head = fs.readFileSync(path.join(adminDir, 'HEAD'), 'utf8');
  if (!/^(ref: refs\/heads\/\S+|[0-9a-f]{40}|[0-9a-f]{64})\n?$/.test(head)) {
    throw new Error(`${adminDir}/HEAD is not a branch or a commit`);
  }
  writeIfChanged(path.join(dir, 'HEAD'), head);
  return { dir, head };
}

function writeIfChanged(file: string, contents: string): void {
  try {
    if (fs.readFileSync(file, 'utf8') === contents) return;
  } catch {
    // Not written yet.
  }
  fs.writeFileSync(file, contents);
}

/** Written beside and renamed over, so a symlink the sandbox left at `file` is replaced rather than followed. */
function replaceFile(file: string, contents: string): void {
  const temp = `${file}.ouijit-${process.pid}`;
  fs.writeFileSync(temp, contents, { flag: 'wx' });
  fs.renameSync(temp, file);
}

/** Where git looks for a repository when run in `dir`: in a task's worktree, the git dirs Ouijit made for it. */
function locate(dir: string): GitLocation {
  const task = getTaskHoldingPath(path.resolve(dir));
  if (!task) return { args: HARDENED_GIT_CONFIG };
  const commonDir = mainGitDirOf(task.projectPath);
  if (!commonDir) return { args: HARDENED_GIT_CONFIG };
  const adminDir = worktreeAdminDir(commonDir, task.worktreePath);
  const standIn = standInGitDir(commonDir, adminDir);
  return {
    args: [...HARDENED_GIT_CONFIG, `--git-dir=${standIn.dir}`, `--work-tree=${task.worktreePath}`],
    env: { GIT_COMMON_DIR: commonDir, GIT_INDEX_FILE: path.join(adminDir, 'index') },
    settle: () => {
      const head = fs.readFileSync(path.join(standIn.dir, 'HEAD'), 'utf8');
      if (head !== standIn.head) replaceFile(path.join(adminDir, 'HEAD'), head);
    },
  };
}

function withLocation(dir: string, args: string[], options: ExecFileOptions) {
  const location = locate(dir);
  return {
    argv: [...location.args, ...args],
    options: {
      ...options,
      cwd: dir,
      ...(location.env && { env: { ...(options.env ?? process.env), ...location.env } }),
    },
    settle: location.settle ?? (() => {}),
  };
}

/** Runs git in `dir` on the host, against the repository Ouijit recorded for it. */
export async function execGit(
  args: string[],
  dir: string,
  options: Omit<ExecFileOptions, 'cwd'> = {},
): Promise<{ stdout: string; stderr: string }> {
  const { argv, options: opts, settle } = withLocation(dir, args, options);
  try {
    return await execFileAsync('git', argv, { ...opts, encoding: 'utf8' });
  } finally {
    settle();
  }
}

/** `execGit`, for a caller reading bytes. */
export async function execGitBuffer(
  args: string[],
  dir: string,
  options: Omit<ExecFileOptions, 'cwd'> = {},
): Promise<Buffer> {
  const { argv, options: opts, settle } = withLocation(dir, args, options);
  try {
    return (await execFileAsync('git', argv, { ...opts, encoding: 'buffer' })).stdout;
  } finally {
    settle();
  }
}

/** `execGit`, blocking. */
export function execGitSync(args: string[], dir: string, options: Omit<ExecFileOptions, 'cwd'> = {}): string {
  const { argv, options: opts, settle } = withLocation(dir, args, options);
  try {
    return execFileSync('git', argv, { stdio: ['pipe', 'pipe', 'pipe'], ...opts, encoding: 'utf8' });
  } finally {
    settle();
  }
}
