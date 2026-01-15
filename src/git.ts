import { execSync } from 'node:child_process';
import { formatAge } from './utils/formatDate';

/**
 * Common exec options for git commands
 */
function gitExecOpts(projectPath: string) {
  return {
    cwd: projectPath,
    encoding: 'utf8' as const,
    stdio: ['pipe', 'pipe', 'pipe'] as const,
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
  status: 'M' | 'A' | 'D' | 'R' | '?';  // Modified, Added, Deleted, Renamed, Untracked
  oldPath?: string;  // For renamed files
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
}

/**
 * Compact git status for at-a-glance display
 */
export interface CompactGitStatus {
  branch: string;
  mainBranch: string;
  commitsAheadOfMain: number;
  dirtyFileCount: number;
  insertions: number;
  deletions: number;
  // Branch vs main comparison (total changes in this branch compared to main)
  branchDiffFileCount: number;
  branchDiffInsertions: number;
  branchDiffDeletions: number;
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
 * Detects the main branch (main or master) for a repo
 */
function getMainBranch(projectPath: string): string {
  const opts = gitExecOpts(projectPath);

  try {
    execSync('git rev-parse --verify main', opts);
    return 'main';
  } catch {
    try {
      execSync('git rev-parse --verify master', opts);
      return 'master';
    } catch {
      return 'main'; // Default to main
    }
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
  limit: number = 5
): RecentBranch[] {
  const opts = gitExecOpts(projectPath);

  try {
    // Get recent branches sorted by committer date
    const result = execSync(
      `git for-each-ref --sort=-committerdate --format='%(refname:short)|%(committerdate:unix)' refs/heads/ --count=${limit + 2}`,
      opts
    ).toString().trim();

    if (!result) return [];

    const now = Math.floor(Date.now() / 1000);
    const branches: RecentBranch[] = [];

    for (const line of result.split('\n')) {
      const [name, timestampStr] = line.split('|');
      if (!name || name === currentBranch || name === mainBranch) continue;
      if (branches.length >= limit) break;

      const timestamp = parseInt(timestampStr, 10);
      const age = now - timestamp;

      // Get commits ahead of main
      let commitsAhead = 0;
      try {
        const countResult = execSync(`git rev-list --count ${mainBranch}..${name}`, opts).toString().trim();
        commitsAhead = parseInt(countResult, 10) || 0;
      } catch {
        // Branch may not have common ancestor with main
        commitsAhead = 0;
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
    execSync(`git checkout "${branchName}"`, opts);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Parse git error messages into user-friendly text
    if (errorMsg.includes('Your local changes')) {
      return {
        success: false,
        error: 'Uncommitted changes would be overwritten. Commit or stash first.'
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
    execSync(`git checkout -b "${branchName}"`, opts);
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
        error: 'Uncommitted changes would be overwritten. Commit or stash first.'
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
      execSync(`git checkout "${mainBranch}"`, opts);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.includes('Your local changes')) {
        return { success: false, error: 'Uncommitted changes would be overwritten' };
      }
      return { success: false, error: `Failed to checkout ${mainBranch}` };
    }

    // Merge the feature branch
    try {
      execSync(`git merge "${currentBranch}"`, opts);
      return { success: true, mergedBranch: currentBranch };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      // If merge fails, try to abort and go back
      try {
        execSync('git merge --abort', opts);
      } catch {
        // Ignore abort errors
      }
      // Go back to the original branch
      try {
        execSync(`git checkout "${currentBranch}"`, opts);
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
 * Gets list of changed files with their status and line stats
 */
export function getChangedFiles(projectPath: string): ChangedFile[] {
  const opts = gitExecOpts(projectPath);
  const files: ChangedFile[] = [];

  try {
    // Get numstat for additions/deletions per file
    const statsMap = new Map<string, { additions: number; deletions: number }>();
    try {
      const numstat = execSync('git diff --numstat HEAD', opts).toString().trim();
      if (numstat) {
        for (const line of numstat.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            // Format: additions<tab>deletions<tab>filename
            // Binary files show as '-' for additions/deletions
            const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
            const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
            statsMap.set(parts[2], { additions, deletions });
          }
        }
      }
    } catch {
      // Stats are optional, continue without them
    }

    // Get tracked file changes (modified, deleted, renamed)
    const tracked = execSync('git diff --name-status HEAD', opts).toString().trim();
    if (tracked) {
      for (const line of tracked.split('\n')) {
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

    // Get untracked files (count lines for stats)
    const untracked = execSync('git ls-files --others --exclude-standard', opts).toString().trim();
    if (untracked) {
      for (const filePath of untracked.split('\n')) {
        if (filePath) {
          // For untracked files, count lines as additions
          let additions = 0;
          try {
            const lineCount = execSync(`wc -l < "${filePath}"`, opts).toString().trim();
            additions = parseInt(lineCount, 10) || 0;
          } catch {
            // Can't count lines, leave as 0
          }
          files.push({ path: filePath, status: '?', additions, deletions: 0 });
        }
      }
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Parses unified diff output into structured hunks
 */
function parseDiff(diffOutput: string): DiffHunk[] {
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

/**
 * Gets the diff for a specific file
 */
export function getFileDiff(projectPath: string, filePath: string): FileDiff | null {
  const opts = { ...gitExecOpts(projectPath), maxBuffer: 10 * 1024 * 1024 };

  try {
    let diffOutput: string;

    // Check if file is untracked (new file)
    const untrackedFiles = execSync('git ls-files --others --exclude-standard', opts).toString().trim().split('\n');
    const isUntracked = untrackedFiles.includes(filePath);

    if (isUntracked) {
      // For untracked files, show the entire file as additions
      const fileContent = execSync(`git diff --no-index /dev/null "${filePath}" || true`, { ...opts, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      diffOutput = fileContent;
    } else {
      // For tracked files, get the diff against HEAD
      diffOutput = execSync(`git diff HEAD -- "${filePath}"`, opts).toString();
    }

    if (!diffOutput.trim()) {
      return null;
    }

    return {
      path: filePath,
      hunks: parseDiff(diffOutput),
    };
  } catch {
    return null;
  }
}

/**
 * Gets compact git status for at-a-glance display in the UI
 * Includes commits ahead of main and dirty file count (including untracked)
 */
export function getCompactGitStatus(projectPath: string): CompactGitStatus | null {
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

    // Get commits ahead of main (only if not on main)
    let commitsAheadOfMain = 0;
    if (branch !== mainBranch) {
      try {
        const count = execSync(`git rev-list --count ${mainBranch}..HEAD`, opts).toString().trim();
        commitsAheadOfMain = parseInt(count, 10) || 0;
      } catch {
        // May fail if branches don't share history
        commitsAheadOfMain = 0;
      }
    }

    // Get tracked file changes
    let trackedCount = 0;
    let insertions = 0;
    let deletions = 0;
    try {
      const shortstat = execSync('git diff --shortstat HEAD', opts).toString().trim();
      if (shortstat) {
        const filesMatch = shortstat.match(/(\d+) files? changed/);
        const insertionsMatch = shortstat.match(/(\d+) insertions?\(\+\)/);
        const deletionsMatch = shortstat.match(/(\d+) deletions?\(-\)/);
        trackedCount = filesMatch ? parseInt(filesMatch[1], 10) : 0;
        insertions = insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0;
        deletions = deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0;
      }
    } catch {
      // Ignore errors
    }

    // Get untracked file count
    let untrackedCount = 0;
    try {
      const untracked = execSync('git ls-files --others --exclude-standard', opts).toString().trim();
      if (untracked) {
        untrackedCount = untracked.split('\n').filter(line => line.length > 0).length;
      }
    } catch {
      // Ignore errors
    }

    // Get branch vs main diff stats (total changes in this branch compared to main)
    let branchDiffFileCount = 0;
    let branchDiffInsertions = 0;
    let branchDiffDeletions = 0;
    if (branch !== mainBranch) {
      try {
        const branchDiff = execSync(`git diff --shortstat ${mainBranch}...HEAD`, opts).toString().trim();
        if (branchDiff) {
          const filesMatch = branchDiff.match(/(\d+) files? changed/);
          const insertionsMatch = branchDiff.match(/(\d+) insertions?\(\+\)/);
          const deletionsMatch = branchDiff.match(/(\d+) deletions?\(-\)/);
          branchDiffFileCount = filesMatch ? parseInt(filesMatch[1], 10) : 0;
          branchDiffInsertions = insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0;
          branchDiffDeletions = deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0;
        }
      } catch {
        // Ignore errors - may fail if branches don't share history
      }
    }

    return {
      branch,
      mainBranch,
      commitsAheadOfMain,
      dirtyFileCount: trackedCount + untrackedCount,
      insertions,
      deletions,
      branchDiffFileCount,
      branchDiffInsertions,
      branchDiffDeletions,
    };
  } catch {
    return null;
  }
}
