import { execSync, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { formatAge } from './utils/formatDate';

const execFileAsync = promisify(execFile);

/**
 * Common exec options for git commands
 */
function gitExecOpts(projectPath: string) {
  return {
    cwd: projectPath,
    encoding: 'utf8' as const,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
  };
}

/**
 * Git status information for a project
 */
export interface GitStatus {
  branch: string;
  isDirty: boolean;
}

/**
 * Uncommitted changes summary
 */
export interface UncommittedChanges {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * Extended git status with ahead/behind info
 */
export interface ExtendedGitStatus {
  branch: string;
  ahead: number;
  behind: number;
  uncommitted: UncommittedChanges | null;
}

/**
 * Recent branch information
 */
export interface RecentBranch {
  name: string;
  commitsAhead: number;
  lastCommitAge: string; // "2d", "5h", "1w"
}

/**
 * Full git dropdown info
 */
export interface GitDropdownInfo {
  current: ExtendedGitStatus;
  recentBranches: RecentBranch[];
  mainBranch: string;
}

/**
 * A changed file with its status
 */
export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?'; // Modified, Added, Deleted, Renamed, Untracked
  oldPath?: string; // For renamed files
  additions: number;
  deletions: number;
}

/**
 * A line in a diff
 */
export interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/**
 * A hunk in a diff
 */
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/**
 * Full diff for a file
 */
export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  /**
   * Git could not express the change as lines — an image, a font, any binary
   * asset. There are no hunks in that case, so a viewer that only knows how to
   * draw hunks has to be told the difference between "nothing to show" and
   * "something to show that isn't text".
   */
  binary?: boolean;
}

/** One version of a binary file, read out of the object database. */
export interface BlobContent {
  byteSize: number;
  /** Base64 of the blob. Absent when the blob is past the caller's cap. */
  base64?: string;
}

/**
 * Detailed git file status — single source of truth for both the GitStats button
 * and the DiffPanel. Contains per-file ChangedFile arrays instead of aggregate counts.
 */
export interface GitFileStatus {
  branch: string;
  mainBranch: string;
  commitsAheadOfMain: number;
  /** Tracked working tree changes vs HEAD */
  uncommittedFiles: ChangedFile[];
  /** Branch changes vs main (empty when on main) */
  branchDiffFiles: ChangedFile[];
  /**
   * Untracked files not in .gitignore, counted like any other change.
   *
   * Held apart from the two lists above rather than folded into them because
   * they belong to both — an untracked file is as much a part of the branch's
   * changes as of the working tree's — while the choice between those two
   * modes is made on tracked changes alone.
   */
  untrackedFiles: ChangedFile[];
}

/**
 * Information about a git branch
 */
export interface BranchInfo {
  name: string;
  isMain: boolean;
}

/**
 * Lists all local branches in a repository
 */
export function listBranches(projectPath: string): BranchInfo[] {
  const opts = gitExecOpts(projectPath);

  try {
    const mainBranch = getMainBranch(projectPath);

    // Get all local branches sorted by most recent commit
    const result = execSync("git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads/", opts)
      .toString()
      .trim();

    if (!result) return [];

    return result
      .split('\n')
      .filter((name) => name.trim())
      .map((name) => ({
        name: name.trim(),
        isMain: name.trim() === mainBranch,
      }));
  } catch {
    return [];
  }
}

/**
 * Gets the current git branch and dirty status for a project
 * @param projectPath - Path to the project directory
 * @returns GitStatus object or null if not a git repo or commands fail
 */
export function getGitStatus(projectPath: string): GitStatus | null {
  const opts = gitExecOpts(projectPath);

  try {
    // Get current branch name
    let branch: string;
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
    } catch {
      // Not a git repo or no commits yet
      return null;
    }

    // Check if working directory is dirty
    let isDirty = false;
    try {
      const status = execSync('git status --porcelain', opts).toString();
      isDirty = status.length > 0;
    } catch {
      // If status fails, assume clean
      isDirty = false;
    }

    return { branch, isDirty };
  } catch {
    return null;
  }
}

/**
 * Cache the resolved main branch per project. `git branch --list` is cheap
 * but it spawns a child process — when this used to run synchronously from
 * inside the otherwise-async `getGitFileStatus`, it blocked the main process
 * on every git-status refresh (30s timer per project, plus 3s after every
 * terminal output burst). The cache is a Map<projectPath, mainBranch>; main
 * branches effectively never change during a session.
 */
const projectMainBranchCache = new Map<string, string>();

function parseMainBranchOutput(stdout: string): string {
  if (!stdout) return 'main';
  const branches = stdout
    .split('\n')
    .map((b) => b.replace(/^\*?\s+/, '').trim())
    .filter(Boolean);
  if (branches.includes('main')) return 'main';
  if (branches.includes('master')) return 'master';
  return 'main';
}

/**
 * Detects the main branch (main or master) for a repo. Sync — kept for the
 * many legacy sync git helpers in this file. First call per project spawns
 * `git branch --list`; subsequent calls return from cache.
 */
export function getMainBranch(projectPath: string): string {
  const cached = projectMainBranchCache.get(projectPath);
  if (cached) return cached;

  const opts = gitExecOpts(projectPath);
  try {
    const result = execFileSync('git', ['branch', '--list', 'main', 'master'], opts).toString();
    const main = parseMainBranchOutput(result);
    projectMainBranchCache.set(projectPath, main);
    return main;
  } catch {
    return 'main';
  }
}

/**
 * Per-project in-flight Promise for `getMainBranchAsync`. Without it, the
 * periodic git-status refresh, an open DiffPanel, and a worktree merge can
 * all hit a cold cache concurrently and each spawn their own `git branch
 * --list` — the cache exists to prevent exactly that.
 */
const mainBranchInflight = new Map<string, Promise<string>>();

/**
 * Async variant for hot paths (most importantly `getGitFileStatus`). Falls
 * through to `execFileAsync` on cache miss so the main process isn't blocked.
 */
export async function getMainBranchAsync(projectPath: string): Promise<string> {
  const cached = projectMainBranchCache.get(projectPath);
  if (cached) return cached;

  const pending = mainBranchInflight.get(projectPath);
  if (pending) return pending;

  const fetchPromise = (async () => {
    try {
      const { stdout } = await execFileAsync('git', ['branch', '--list', 'main', 'master'], gitExecOpts(projectPath));
      const main = parseMainBranchOutput(stdout);
      projectMainBranchCache.set(projectPath, main);
      return main;
    } catch {
      return 'main';
    }
  })();

  mainBranchInflight.set(projectPath, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    mainBranchInflight.delete(projectPath);
  }
}

/** Drop the cached main branch for a project (call after a rename or fresh clone). */
export function invalidateMainBranchCache(projectPath?: string): void {
  if (projectPath == null) {
    projectMainBranchCache.clear();
    mainBranchInflight.clear();
  } else {
    projectMainBranchCache.delete(projectPath);
    mainBranchInflight.delete(projectPath);
  }
}

/**
 * Reads a remote's fetch URL. Async because every caller (repo identity
 * resolution, the GitHub availability probe) is off the hot path and the
 * main process should not block on a subprocess for it.
 *
 * Returns null when the repo has no such remote, or isn't a repo at all.
 */
export async function getRemoteUrl(projectPath: string, remote = 'origin'): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', remote], gitExecOpts(projectPath));
    const url = stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Fetch a refspec from a remote. The GitHub integration uses this to pull a PR
 * head into a namespaced local ref so the diff can be read straight out of the
 * object database — no checkout, no worktree, and nothing added to the user's
 * branch list.
 */
export async function fetchRefspec(
  projectPath: string,
  remote: string,
  refspec: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync('git', ['fetch', '--no-tags', '--force', remote, refspec], {
      ...gitExecOpts(projectPath),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Fetch failed' };
  }
}

/** Resolve a revision to a full SHA, or null when it isn't present locally. */
export async function resolveRef(projectPath: string, rev: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `${rev}^{commit}`], {
      cwd: projectPath,
      encoding: 'utf8',
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Push a branch to a remote, setting upstream. Used by the task-to-PR path,
 * which needs the branch on the remote before `gh pr create` can reference it.
 */
export async function pushBranch(
  projectPath: string,
  branch: string,
  remote = 'origin',
  options?: { force?: boolean },
): Promise<{ success: boolean; error?: string }> {
  const args = ['push', '--set-upstream'];
  if (options?.force) args.push('--force-with-lease');
  args.push(remote, branch);
  try {
    await execFileAsync('git', args, { ...gitExecOpts(projectPath), maxBuffer: 10 * 1024 * 1024 });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Push failed';
    if (/non-fast-forward|rejected/i.test(message)) {
      return { success: false, error: 'Remote has commits this branch does not. Pull or force-push.' };
    }
    if (/Permission denied|could not read Username|Authentication failed/i.test(message)) {
      return { success: false, error: 'Push was rejected: no write access to the remote.' };
    }
    return { success: false, error: message.split('\n').slice(0, 3).join(' ').trim() || 'Push failed' };
  }
}

/**
 * Three-dot diff between two revisions, listing changed files with per-file
 * stats. Same shape `getWorktreeDiff` produces, but pinned to SHAs rather than
 * branch names — GitHub computes a PR's diff as `base...head`, so pinning to
 * the SHAs the API reports is what makes the resulting line numbers valid
 * review anchors.
 */
export async function getRangeDiffFiles(
  projectPath: string,
  baseRev: string,
  headRev: string,
): Promise<ChangedFile[] | null> {
  const range = `${baseRev}...${headRev}`;
  try {
    const [numstat, nameStatus] = await Promise.all([
      gitAsync(['diff', '--numstat', range], projectPath),
      gitAsync(['diff', '--name-status', range], projectPath),
    ]);
    return parseNameStatus(nameStatus, parseNumstat(numstat));
  } catch {
    return null;
  }
}

/**
 * Per-file diff for a revision range. Mirrors `getWorktreeFileDiff` on SHAs.
 *
 * `oldPath` matters for a rename: git pairs the two sides by seeing both paths
 * in the pathspec, and given only the new one it reports the file as freshly
 * added with every line as an addition rather than as a rename with the lines
 * that actually changed.
 */
export async function getRangeFileDiff(
  projectPath: string,
  baseRev: string,
  headRev: string,
  filePath: string,
  contextLines?: number,
  oldPath?: string,
): Promise<FileDiff | null> {
  const args = ['diff'];
  if (contextLines != null) args.push(`-U${contextLines}`);
  args.push(`${baseRev}...${headRev}`, '--', filePath);
  if (oldPath && oldPath !== filePath) args.push(oldPath);
  try {
    const { stdout } = await execFileAsync('git', args, {
      ...gitExecOpts(projectPath),
      maxBuffer: 20 * 1024 * 1024,
    });
    return toFileDiff(filePath, stdout);
  } catch {
    return null;
  }
}

/**
 * Gets ahead/behind count relative to upstream
 */
function getAheadBehind(projectPath: string): { ahead: number; behind: number } {
  const opts = gitExecOpts(projectPath);

  try {
    const result = execSync('git rev-list --left-right --count HEAD...@{upstream}', opts).toString().trim();
    const [ahead, behind] = result.split('\t').map(Number);
    return { ahead: ahead || 0, behind: behind || 0 };
  } catch {
    // No upstream or error
    return { ahead: 0, behind: 0 };
  }
}

/**
 * Gets uncommitted changes summary
 */
function getUncommittedChanges(projectPath: string): UncommittedChanges | null {
  const opts = gitExecOpts(projectPath);

  try {
    const result = execSync('git diff --shortstat HEAD', opts).toString().trim();
    if (!result) return null;

    // Parse: "3 files changed, 47 insertions(+), 12 deletions(-)"
    const filesMatch = result.match(/(\d+) files? changed/);
    const insertionsMatch = result.match(/(\d+) insertions?\(\+\)/);
    const deletionsMatch = result.match(/(\d+) deletions?\(-\)/);

    const filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;
    const insertions = insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0;
    const deletions = deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0;

    if (filesChanged === 0 && insertions === 0 && deletions === 0) return null;

    return { filesChanged, insertions, deletions };
  } catch {
    return null;
  }
}

/**
 * Gets recent branches with their commit info
 */
function getRecentBranches(
  projectPath: string,
  currentBranch: string,
  mainBranch: string,
  limit: number = 5,
): RecentBranch[] {
  const opts = gitExecOpts(projectPath);

  try {
    // Get recent branches with ahead-behind counts in a single command (Git 2.36+)
    // %(ahead-behind:ref) returns "ahead\tbehind" relative to the given ref
    let result: string;
    let useAheadBehind = true;

    try {
      result = execFileSync(
        'git',
        [
          'for-each-ref',
          '--sort=-committerdate',
          `--format=%(refname:short)|%(committerdate:unix)|%(ahead-behind:${mainBranch})`,
          'refs/heads/',
          `--count=${limit + 2}`,
        ],
        opts,
      )
        .toString()
        .trim();
    } catch {
      // Fallback for older Git versions without %(ahead-behind)
      useAheadBehind = false;
      result = execSync(
        `git for-each-ref --sort=-committerdate --format='%(refname:short)|%(committerdate:unix)' refs/heads/ --count=${limit + 2}`,
        opts,
      )
        .toString()
        .trim();
    }

    if (!result) return [];

    const now = Math.floor(Date.now() / 1000);
    const branches: RecentBranch[] = [];

    for (const line of result.split('\n')) {
      const parts = line.split('|');
      const name = parts[0];
      const timestampStr = parts[1];
      if (!name || name === currentBranch || name === mainBranch) continue;
      if (branches.length >= limit) break;

      const timestamp = parseInt(timestampStr, 10);
      const age = now - timestamp;

      let commitsAhead = 0;
      if (useAheadBehind && parts[2]) {
        // Format: "ahead\tbehind"
        const [ahead] = parts[2].split('\t');
        commitsAhead = parseInt(ahead, 10) || 0;
      } else if (!useAheadBehind) {
        try {
          const countResult = execFileSync('git', ['rev-list', '--count', `${mainBranch}..${name}`], opts)
            .toString()
            .trim();
          commitsAhead = parseInt(countResult, 10) || 0;
        } catch {
          commitsAhead = 0;
        }
      }

      branches.push({
        name,
        commitsAhead,
        lastCommitAge: formatAge(age),
      });
    }

    return branches;
  } catch {
    return [];
  }
}

/**
 * Gets full dropdown info for git status
 */
export function getGitDropdownInfo(projectPath: string): GitDropdownInfo | null {
  const opts = gitExecOpts(projectPath);

  try {
    // Get current branch
    let branch: string;
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
    } catch {
      return null; // Not a git repo
    }

    const mainBranch = getMainBranch(projectPath);
    const { ahead, behind } = getAheadBehind(projectPath);
    const uncommitted = getUncommittedChanges(projectPath);
    const recentBranches = getRecentBranches(projectPath, branch, mainBranch);

    return {
      current: {
        branch,
        ahead,
        behind,
        uncommitted,
      },
      recentBranches,
      mainBranch,
    };
  } catch {
    return null;
  }
}

/**
 * Checkout a git branch
 */
export function checkoutBranch(projectPath: string, branchName: string): { success: boolean; error?: string } {
  const opts = gitExecOpts(projectPath);

  try {
    execFileSync('git', ['checkout', branchName], opts);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Parse git error messages into user-friendly text
    if (errorMsg.includes('Your local changes')) {
      return {
        success: false,
        error: 'Uncommitted changes would be overwritten. Commit or stash first.',
      };
    }
    if (errorMsg.includes('did not match any')) {
      return { success: false, error: `Branch '${branchName}' not found` };
    }

    return { success: false, error: 'Checkout failed' };
  }
}

/**
 * Create a new git branch and switch to it
 */
export function createBranch(projectPath: string, branchName: string): { success: boolean; error?: string } {
  const opts = gitExecOpts(projectPath);

  try {
    execFileSync('git', ['checkout', '-b', branchName], opts);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Parse git error messages into user-friendly text
    if (errorMsg.includes('already exists')) {
      return { success: false, error: `Branch '${branchName}' already exists` };
    }
    if (errorMsg.includes('Your local changes')) {
      return {
        success: false,
        error: 'Uncommitted changes would be overwritten. Commit or stash first.',
      };
    }
    if (errorMsg.includes('is not a valid branch name')) {
      return { success: false, error: 'Invalid branch name' };
    }

    return { success: false, error: 'Failed to create branch' };
  }
}

/**
 * Merge current branch into main (checkout main, merge feature branch)
 */
export function mergeIntoMain(projectPath: string): { success: boolean; error?: string; mergedBranch?: string } {
  const opts = gitExecOpts(projectPath);

  try {
    // Get current branch name first
    let currentBranch: string;
    try {
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
    } catch {
      return { success: false, error: 'Not a git repository' };
    }

    const mainBranch = getMainBranch(projectPath);

    // Can't merge main into itself
    if (currentBranch === mainBranch) {
      return { success: false, error: 'Already on main branch' };
    }

    // Check for uncommitted changes
    try {
      const status = execSync('git status --porcelain', opts).toString();
      if (status.length > 0) {
        return { success: false, error: 'Uncommitted changes. Commit or stash first.' };
      }
    } catch {
      return { success: false, error: 'Failed to check git status' };
    }

    // Checkout main
    try {
      execFileSync('git', ['checkout', mainBranch], opts);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.includes('Your local changes')) {
        return { success: false, error: 'Uncommitted changes would be overwritten' };
      }
      return { success: false, error: `Failed to checkout ${mainBranch}` };
    }

    // Merge the feature branch
    try {
      execFileSync('git', ['merge', currentBranch], opts);
      return { success: true, mergedBranch: currentBranch };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      // If merge fails, try to abort and go back
      try {
        execFileSync('git', ['merge', '--abort'], opts);
      } catch {
        // Ignore abort errors
      }
      // Go back to the original branch
      try {
        execFileSync('git', ['checkout', currentBranch], opts);
      } catch {
        // Ignore checkout errors
      }

      if (errorMsg.includes('CONFLICT')) {
        return { success: false, error: 'Merge conflicts. Resolve manually.' };
      }
      return { success: false, error: 'Merge failed' };
    }
  } catch {
    return { success: false, error: 'Merge failed' };
  }
}

/**
 * Whether git declined to diff a file as text.
 *
 * Taken from git's own output rather than guessed from the extension: git
 * decides this from the content and from `.gitattributes`, so a `.txt` marked
 * binary and a `.png` marked text both come out right.
 */
export function isBinaryDiff(diffOutput: string): boolean {
  return /^Binary files .* differ$/m.test(diffOutput) || diffOutput.includes('GIT binary patch');
}

/**
 * One revision's copy of a file, base64 encoded.
 *
 * Returns null when the path does not exist at that revision, which is how an
 * added or deleted file reports its missing side. Blobs past `maxBytes` come
 * back with their size and no content, so a caller can say how big the thing is
 * without moving it across a process boundary.
 */
export async function readBlob(
  projectPath: string,
  rev: string,
  filePath: string,
  maxBytes: number,
): Promise<BlobContent | null> {
  const spec = `${rev}:${filePath}`;

  let byteSize: number;
  try {
    const { stdout } = await execFileAsync('git', ['cat-file', '-s', spec], {
      cwd: projectPath,
      encoding: 'utf8',
    });
    byteSize = Number.parseInt(stdout.trim(), 10);
  } catch {
    return null;
  }
  if (!Number.isFinite(byteSize)) return null;
  if (byteSize > maxBytes) return { byteSize };

  try {
    const { stdout } = await execFileAsync('git', ['cat-file', 'blob', spec], {
      cwd: projectPath,
      encoding: 'buffer',
      maxBuffer: maxBytes + 1024,
    });
    return { byteSize, base64: stdout.toString('base64') };
  } catch {
    return { byteSize };
  }
}

/**
 * Parses unified diff output into structured hunks
 */
export function parseDiff(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffOutput.split('\n');
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Hunk header: @@ -1,3 +1,4 @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({
        type: 'addition',
        content: line.substring(1),
        newLineNo: newLine++,
      });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({
        type: 'deletion',
        content: line.substring(1),
        oldLineNo: oldLine++,
      });
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.substring(1),
        oldLineNo: oldLine++,
        newLineNo: newLine++,
      });
    }
  }

  return hunks;
}

function toFileDiff(filePath: string, diffOutput: string): FileDiff | null {
  if (!diffOutput.trim()) return null;
  return {
    path: filePath,
    hunks: parseDiff(diffOutput),
    binary: isBinaryDiff(diffOutput),
  };
}

/**
 * One file's diff, from whichever `git diff` argv the caller needs.
 *
 * `quiet` is for `--no-index`, which exits 1 to mean "these differ" — the
 * output is on stdout either way, so the failure is the expected case.
 */
async function readFileDiff(
  projectPath: string,
  filePath: string,
  args: string[],
  quiet = false,
): Promise<FileDiff | null> {
  const opts = { ...gitExecOpts(projectPath), maxBuffer: 10 * 1024 * 1024 };
  try {
    const { stdout } = await execFileAsync('git', ['diff', ...args], opts);
    return toFileDiff(filePath, stdout);
  } catch (error) {
    if (quiet && error && typeof error === 'object' && 'stdout' in error) {
      return toFileDiff(filePath, String((error as { stdout: string }).stdout));
    }
    return null;
  }
}

function contextArgs(contextLines?: number): string[] {
  return contextLines != null ? [`-U${contextLines}`] : [];
}

/**
 * The whole of an untracked file, as additions.
 *
 * Exported so a caller that already knows the file is untracked — the file
 * list says so — can name that directly rather than going through `getFileDiff`.
 */
export function getUntrackedFileDiff(
  projectPath: string,
  filePath: string,
  contextLines?: number,
): Promise<FileDiff | null> {
  return readFileDiff(projectPath, filePath, ['--no-index', ...contextArgs(contextLines), '/dev/null', filePath], true);
}

/** A tracked file's diff against HEAD. */
export function getTrackedFileDiff(
  projectPath: string,
  filePath: string,
  contextLines?: number,
): Promise<FileDiff | null> {
  return readFileDiff(projectPath, filePath, [...contextArgs(contextLines), 'HEAD', '--', filePath]);
}

/**
 * Gets the diff for a specific file, tracked or not.
 *
 * `untracked` is required rather than probed for: working it out here would
 * mean listing every untracked path in the repo, once per file. Every caller
 * arrives from a file list that already carries the status.
 */
export function getFileDiff(
  projectPath: string,
  filePath: string,
  contextLines: number | undefined,
  untracked: boolean,
): Promise<FileDiff | null> {
  return untracked
    ? getUntrackedFileDiff(projectPath, filePath, contextLines)
    : getTrackedFileDiff(projectPath, filePath, contextLines);
}

/**
 * The two revisions a branch diff is taken between, as SHAs.
 *
 * Branch names cannot say whether a diff has moved, since they stay put while
 * the commits under them change, so both ends are resolved. Null when either
 * cannot be, which the caller reads as "cannot say".
 */
export async function getBranchDiffPin(
  projectPath: string,
  branch: string,
  targetBranch?: string,
): Promise<string | null> {
  try {
    const base = targetBranch || (await getMainBranchAsync(projectPath));
    const [mergeBase, head] = await Promise.all([
      gitAsync(['merge-base', base, branch], projectPath),
      gitAsync(['rev-parse', branch], projectPath),
    ]);
    if (!mergeBase || !head) return null;
    return `${mergeBase}..${head}`;
  } catch {
    return null;
  }
}

/**
 * Run a git command asynchronously, without blocking the main thread.
 *
 * Exported so nothing else has to build its own way of spawning git — one set
 * of defaults, one place to change them. Throws on a non-zero exit, which is
 * how callers ask git a yes/no question.
 */
export async function gitAsync(args: string[], projectPath: string, maxBuffer?: number): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    ...(maxBuffer ? { maxBuffer } : {}),
  });
  return stdout.trim();
}

// ── Shared diff parsing helpers ──────────────────────────────────────

/** Parse `git diff --numstat` output into a per-file stats map */
function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  if (!output) return map;
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      map.set(parts[2], { additions, deletions });
    }
  }
  return map;
}

/** Parse `git diff --name-status` output, enriched with numstat data */
function parseNameStatus(
  output: string,
  statsMap: Map<string, { additions: number; deletions: number }>,
): ChangedFile[] {
  const files: ChangedFile[] = [];
  if (!output) return files;
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const statusChar = parts[0][0] as ChangedFile['status'];
      const filePath = statusChar === 'R' && parts.length >= 3 ? parts[2] : parts[1];
      const stats = statsMap.get(filePath) || { additions: 0, deletions: 0 };
      if (statusChar === 'R' && parts.length >= 3) {
        files.push({ path: parts[2], status: 'R', oldPath: parts[1], ...stats });
      } else {
        files.push({ path: parts[1], status: statusChar, ...stats });
      }
    }
  }
  return files;
}

/** Past this, a file is reported without a line count rather than read. */
const UNTRACKED_COUNT_LIMIT = 2 * 1024 * 1024;

/** How many untracked files are read at once. */
const UNTRACKED_READ_BATCH = 16;

/**
 * Line counts already worked out, keyed by the file and the version of it.
 *
 * The status poll runs every few seconds and almost nothing it lists has
 * changed since last time, so the `stat` each entry is keyed on is usually the
 * whole cost. Bounded because a long session in a repo with a busy build
 * directory would otherwise accumulate an entry per path ever seen.
 */
const untrackedLines = new Map<string, number>();
const UNTRACKED_CACHE_LIMIT = 5000;

/**
 * Untracked paths as changed files, with the line count each one would add.
 *
 * Counted here rather than by `git diff --no-index`, which would be one child
 * process per file on a status poll that runs every few seconds. Binary files
 * report no lines, matching what the diff view will say about them.
 */
async function countUntracked(projectPath: string, paths: string[]): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];
  // In batches: a repo with hundreds of untracked files would otherwise have
  // every one of them open at once.
  for (let i = 0; i < paths.length; i += UNTRACKED_READ_BATCH) {
    files.push(...(await Promise.all(paths.slice(i, i + UNTRACKED_READ_BATCH).map((p) => countOne(projectPath, p)))));
  }
  return files;
}

async function countOne(projectPath: string, relPath: string): Promise<ChangedFile> {
  const file: ChangedFile = { path: relPath, status: '?', additions: 0, deletions: 0 };
  try {
    const absolute = path.join(projectPath, relPath);
    const stats = await fs.stat(absolute);
    if (!stats.isFile() || stats.size > UNTRACKED_COUNT_LIMIT) return file;

    const key = `${absolute}\0${stats.size}\0${stats.mtimeMs}`;
    const cached = untrackedLines.get(key);
    if (cached !== undefined) {
      file.additions = cached;
      return file;
    }

    const contents = await fs.readFile(absolute);
    // The same test git uses: a NUL byte early on means it is not text.
    if (contents.subarray(0, 8000).includes(0)) return file;

    // `indexOf` scans in native code. Iterating the Buffer in JS to do the
    // same thing runs on the main thread, and this is on a status poll.
    let lines = 0;
    for (let at = contents.indexOf(0x0a); at !== -1; at = contents.indexOf(0x0a, at + 1)) lines++;
    // A final line with no newline after it is still a line.
    if (contents.length > 0 && contents[contents.length - 1] !== 0x0a) lines++;

    if (untrackedLines.size >= UNTRACKED_CACHE_LIMIT) untrackedLines.clear();
    untrackedLines.set(key, lines);
    file.additions = lines;
  } catch {
    // Deleted between the listing and now, or unreadable — still a file
    // the diff should mention, just without a count.
  }
  return file;
}

// ── Unified git file status ─────────────────────────────────────────

/**
 * Gets detailed git file status — single source of truth for both the GitStats
 * button and the DiffPanel. Fully async to avoid blocking the main thread.
 */
export async function getGitFileStatus(projectPath: string, diffBase?: string): Promise<GitFileStatus | null> {
  try {
    let branch: string;
    try {
      branch = await gitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
    } catch {
      return null; // Not a git repo
    }

    const mainBranch = await getMainBranchAsync(projectPath);
    const base = diffBase || mainBranch;
    const isOnBase = branch === base;

    // Run all independent git commands in parallel
    const [
      uncommittedNumstatResult,
      uncommittedNameStatusResult,
      untrackedResult,
      commitsAheadResult,
      branchNumstatResult,
      branchNameStatusResult,
    ] = await Promise.allSettled([
      gitAsync(['diff', '--numstat', 'HEAD'], projectPath),
      gitAsync(['diff', '--name-status', 'HEAD'], projectPath),
      gitAsync(['ls-files', '--others', '--exclude-standard'], projectPath),
      isOnBase ? Promise.resolve('') : gitAsync(['rev-list', '--count', `${base}..HEAD`], projectPath),
      isOnBase ? Promise.resolve('') : gitAsync(['diff', '--numstat', `${base}...HEAD`], projectPath),
      isOnBase ? Promise.resolve('') : gitAsync(['diff', '--name-status', `${base}...HEAD`], projectPath),
    ]);

    // Build uncommitted tracked files
    const uncommittedStatsMap =
      uncommittedNumstatResult.status === 'fulfilled' ? parseNumstat(uncommittedNumstatResult.value) : new Map();
    const uncommittedFiles =
      uncommittedNameStatusResult.status === 'fulfilled'
        ? parseNameStatus(uncommittedNameStatusResult.value, uncommittedStatsMap)
        : [];

    // Parse untracked file paths, then count what each one would add.
    const untrackedPaths =
      untrackedResult.status === 'fulfilled' && untrackedResult.value
        ? untrackedResult.value.split('\n').filter(Boolean)
        : [];
    const untrackedFiles = await countUntracked(projectPath, untrackedPaths);

    // Build branch diff files
    const branchStatsMap =
      branchNumstatResult.status === 'fulfilled' ? parseNumstat(branchNumstatResult.value) : new Map();
    const branchDiffFiles =
      branchNameStatusResult.status === 'fulfilled'
        ? parseNameStatus(branchNameStatusResult.value, branchStatsMap)
        : [];

    // Parse commits ahead
    const commitsAheadOfMain =
      commitsAheadResult.status === 'fulfilled' && commitsAheadResult.value
        ? parseInt(commitsAheadResult.value, 10) || 0
        : 0;

    return { branch, mainBranch, commitsAheadOfMain, uncommittedFiles, branchDiffFiles, untrackedFiles };
  } catch {
    return null;
  }
}

/**
 * Summary of changes between a worktree branch and main
 */
export interface WorktreeDiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: ChangedFile[];
}

/**
 * Gets the diff summary between a worktree branch and a target branch
 */
export function getWorktreeDiff(
  projectPath: string,
  worktreeBranch: string,
  targetBranch?: string,
): WorktreeDiffSummary | null {
  const opts = gitExecOpts(projectPath);
  const baseBranch = targetBranch || getMainBranch(projectPath);

  try {
    const files: ChangedFile[] = [];

    // Get numstat for additions/deletions per file
    const statsMap = new Map<string, { additions: number; deletions: number }>();
    let totalInsertions = 0;
    let totalDeletions = 0;

    try {
      const numstat = execFileSync('git', ['diff', '--numstat', `${baseBranch}...${worktreeBranch}`], opts)
        .toString()
        .trim();

      if (numstat) {
        for (const line of numstat.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
            const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
            statsMap.set(parts[2], { additions, deletions });
            totalInsertions += additions;
            totalDeletions += deletions;
          }
        }
      }
    } catch {
      // Stats are optional
    }

    // Get file status (modified, added, deleted)
    const nameStatus = execFileSync('git', ['diff', '--name-status', `${baseBranch}...${worktreeBranch}`], opts)
      .toString()
      .trim();

    if (nameStatus) {
      for (const line of nameStatus.split('\n')) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const statusChar = parts[0][0] as ChangedFile['status'];
          const filePath = statusChar === 'R' && parts.length >= 3 ? parts[2] : parts[1];
          const stats = statsMap.get(filePath) || { additions: 0, deletions: 0 };

          if (statusChar === 'R' && parts.length >= 3) {
            files.push({ path: parts[2], status: 'R', oldPath: parts[1], ...stats });
          } else {
            files.push({ path: parts[1], status: statusChar, ...stats });
          }
        }
      }
    }

    return {
      filesChanged: files.length,
      insertions: totalInsertions,
      deletions: totalDeletions,
      files,
    };
  } catch {
    return null;
  }
}

/**
 * Gets the diff for a specific file between worktree branch and a target branch
 */
export async function getWorktreeFileDiff(
  projectPath: string,
  worktreeBranch: string,
  filePath: string,
  targetBranch?: string,
  contextLines?: number,
): Promise<FileDiff | null> {
  const baseBranch = targetBranch || (await getMainBranchAsync(projectPath));
  return readFileDiff(projectPath, filePath, [
    ...contextArgs(contextLines),
    `${baseBranch}...${worktreeBranch}`,
    '--',
    filePath,
  ]);
}

/**
 * Merge a specific branch into a target branch (defaults to main)
 */
export function mergeWorktreeBranch(
  projectPath: string,
  branchToMerge: string,
  commitMessage?: string,
  targetBranch?: string,
): { success: boolean; error?: string; mergedBranch?: string } {
  const opts = gitExecOpts(projectPath);

  try {
    const mergeTo = targetBranch || getMainBranch(projectPath);

    // Check for uncommitted changes in main repo
    try {
      const status = execSync('git status --porcelain', opts).toString();
      if (status.length > 0) {
        return { success: false, error: 'Uncommitted changes in main repo. Commit or stash first.' };
      }
    } catch {
      return { success: false, error: 'Failed to check git status' };
    }

    // Get current branch
    let currentBranch: string;
    try {
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
    } catch {
      return { success: false, error: 'Not a git repository' };
    }

    // Checkout target branch if not already there
    if (currentBranch !== mergeTo) {
      try {
        execFileSync('git', ['checkout', mergeTo], opts);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '';
        if (errorMsg.includes('Your local changes')) {
          return { success: false, error: 'Uncommitted changes would be overwritten' };
        }
        return { success: false, error: `Failed to checkout ${mergeTo}` };
      }
    }

    // Squash merge the worktree branch
    try {
      execFileSync('git', ['merge', '--squash', branchToMerge], opts);
      // Create the squash commit with custom or default message
      const commitMsg = commitMessage || branchToMerge.replace(/-\d{10,}$/, '').replace(/-/g, ' ');
      execFileSync('git', ['commit', '-m', commitMsg], opts);
      return { success: true, mergedBranch: branchToMerge };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      // If merge fails, try to abort/reset
      try {
        execFileSync('git', ['merge', '--abort'], opts);
      } catch {
        // merge --abort may fail if squash merge, try reset instead
        try {
          execFileSync('git', ['reset', '--hard', 'HEAD'], opts);
        } catch {
          // Ignore reset errors
        }
      }
      // Go back to the original branch if we switched
      if (currentBranch !== mergeTo) {
        try {
          execFileSync('git', ['checkout', currentBranch], opts);
        } catch {
          // Ignore checkout errors
        }
      }

      if (errorMsg.includes('CONFLICT')) {
        return { success: false, error: 'Merge conflicts. Resolve manually.' };
      }
      return { success: false, error: 'Merge failed' };
    }
  } catch {
    return { success: false, error: 'Merge failed' };
  }
}
