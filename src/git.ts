import { execSync } from 'node:child_process';

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
 * Gets the current git branch and dirty status for a project
 * @param projectPath - Path to the project directory
 * @returns GitStatus object or null if not a git repo or commands fail
 */
export function getGitStatus(projectPath: string): GitStatus | null {
  const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };

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
  const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };

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
  const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };

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
  const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };

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
 * Formats seconds into a human-readable age string
 */
function formatAge(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months}mo`;
  if (weeks > 0) return `${weeks}w`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'now';
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
  const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };

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
  const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };

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
  const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };

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
