/**
 * Git status display for project mode - per-terminal git status on card labels
 */

import type { CompactGitStatus } from '../../types';
import { projectState, GIT_STATUS_IDLE_DELAY, ProjectTerminal } from './state';
import { getTerminalGitPath } from './helpers';
import { projectPath, terminals, gitDropdownVisible } from './signals';

/**
 * Hide the git dropdown (cleanup for exitProjectMode)
 */
export function hideGitDropdown(): void {
  if (!gitDropdownVisible.value) return;

  if (projectState.gitDropdownCleanup) {
    projectState.gitDropdownCleanup();
    projectState.gitDropdownCleanup = null;
  }

  gitDropdownVisible.value = false;
}

/**
 * Refresh git status for all terminals
 */
export async function refreshGitStatus(): Promise<void> {
  if (!projectPath.value) return;
  await refreshAllTerminalGitStatus();
}

/**
 * Schedule a git status refresh after idle period
 */
export function scheduleGitStatusRefresh(): void {
  // Clear any existing timeout
  if (projectState.gitStatusIdleTimeout) {
    clearTimeout(projectState.gitStatusIdleTimeout);
  }

  // Update last output time
  projectState.lastTerminalOutputTime = Date.now();

  // Schedule refresh after idle period
  projectState.gitStatusIdleTimeout = setTimeout(() => {
    refreshGitStatus();
  }, GIT_STATUS_IDLE_DELAY);
}

// Map of pending per-terminal git status refreshes
const pendingTerminalGitRefreshes = new Map<string, ReturnType<typeof setTimeout>>();


/**
 * Schedule a debounced git status refresh for a specific terminal
 * @param term - The terminal to refresh
 * @param onComplete - Optional callback to run after refresh (e.g., to update UI)
 */
export function scheduleTerminalGitStatusRefresh(
  term: ProjectTerminal,
  onComplete?: (term: ProjectTerminal) => void
): void {
  const key = term.ptyId;
  const existing = pendingTerminalGitRefreshes.get(key);
  if (existing) clearTimeout(existing);

  pendingTerminalGitRefreshes.set(key, setTimeout(async () => {
    await refreshTerminalGitStatus(term);
    onComplete?.(term);
    pendingTerminalGitRefreshes.delete(key);
  }, GIT_STATUS_IDLE_DELAY));
}

/**
 * Refresh git status for a specific terminal
 */
export async function refreshTerminalGitStatus(term: ProjectTerminal): Promise<void> {
  const gitPath = getTerminalGitPath(term);
  const compactStatus = await window.api.getCompactGitStatus(gitPath);
  term.gitStatus = compactStatus;
}

/**
 * Refresh git status for all terminals, deduplicating by git path
 * Terminals sharing the same project path only trigger one IPC call
 */
export async function refreshAllTerminalGitStatus(): Promise<void> {
  const currentTerminals = terminals.value;
  if (currentTerminals.length === 0) return;

  // Group terminals by git path to avoid duplicate IPC calls
  const pathToTerminals = new Map<string, ProjectTerminal[]>();
  for (const term of currentTerminals) {
    const gitPath = getTerminalGitPath(term);
    const group = pathToTerminals.get(gitPath);
    if (group) {
      group.push(term);
    } else {
      pathToTerminals.set(gitPath, [term]);
    }
  }

  // One IPC call per unique path, then share result
  await Promise.all(
    Array.from(pathToTerminals.entries()).map(async ([gitPath, terms]) => {
      const compactStatus = await window.api.getCompactGitStatus(gitPath);
      for (const term of terms) {
        term.gitStatus = compactStatus;
      }
    })
  );
}

/**
 * Build compact git status HTML for display in terminal card
 * Only shows uncommitted changes (working directory vs HEAD)
 */
export function buildCardGitBranchHtml(compactStatus: CompactGitStatus | null): string {
  if (!compactStatus) return '';

  const { branch } = compactStatus;
  return `
    <span class="project-card-git-branch" title="${branch}">
      <i data-icon="git-branch" class="project-card-git-icon"></i>
      <span class="project-card-git-branch-name">${branch}</span>
    </span>
  `;
}

export function buildCardGitStatsHtml(compactStatus: CompactGitStatus | null, isWorktree: boolean = false): string {
  if (!compactStatus) return '';

  const { dirtyFileCount, insertions, deletions } = compactStatus;
  const hasChanges = dirtyFileCount > 0;

  if (hasChanges) {
    const fileLabel = dirtyFileCount === 1 ? 'file' : 'files';
    const parts: string[] = [`<span class="project-card-git-count">${dirtyFileCount} ${fileLabel}</span>`];
    if (insertions > 0) parts.push(`<span class="project-card-git-add">+${insertions}</span>`);
    if (deletions > 0) parts.push(`<span class="project-card-git-del">-${deletions}</span>`);
    return `<span class="card-tab project-card-git-stats project-card-git-stats--clickable" title="View uncommitted changes">${parts.join(' ')}</span>`;
  }

  // No uncommitted changes — show "Compare" for worktree terminals only if branch has changes vs main
  if (isWorktree && compactStatus.branchDiffFileCount > 0) {
    return `<span class="card-tab project-card-git-stats project-card-git-stats--clickable project-card-git-stats--compare" title="Compare branch changes">Compare</span>`;
  }

  return '';
}
