/**
 * Git status display for theatre mode - per-terminal git status on card labels
 */

import type { CompactGitStatus } from '../../types';
import { theatreState, GIT_STATUS_IDLE_DELAY, TheatreTerminal } from './state';
import { getTerminalGitPath } from './helpers';
import { projectPath, terminals, gitDropdownVisible } from './signals';

/**
 * Hide the git dropdown (cleanup for exitTheatreMode)
 */
export function hideGitDropdown(): void {
  if (!gitDropdownVisible.value) return;

  if (theatreState.gitDropdownCleanup) {
    theatreState.gitDropdownCleanup();
    theatreState.gitDropdownCleanup = null;
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
  if (theatreState.gitStatusIdleTimeout) {
    clearTimeout(theatreState.gitStatusIdleTimeout);
  }

  // Update last output time
  theatreState.lastTerminalOutputTime = Date.now();

  // Schedule refresh after idle period
  theatreState.gitStatusIdleTimeout = setTimeout(() => {
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
  term: TheatreTerminal,
  onComplete?: (term: TheatreTerminal) => void
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
export async function refreshTerminalGitStatus(term: TheatreTerminal): Promise<void> {
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
  const pathToTerminals = new Map<string, TheatreTerminal[]>();
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
    <span class="theatre-card-git-branch" title="${branch}">
      <i data-lucide="git-branch" class="theatre-card-git-icon"></i>
      <span class="theatre-card-git-branch-name">${branch}</span>
    </span>
  `;
}

export function buildCardGitStatsHtml(compactStatus: CompactGitStatus | null): string {
  if (!compactStatus) return '';

  const { dirtyFileCount, insertions, deletions } = compactStatus;
  const hasChanges = dirtyFileCount > 0;
  if (!hasChanges) return '';

  const parts: string[] = [`<span class="theatre-card-git-count">${dirtyFileCount}</span>`];
  if (insertions > 0) parts.push(`<span class="theatre-card-git-add">+${insertions}</span>`);
  if (deletions > 0) parts.push(`<span class="theatre-card-git-del">-${deletions}</span>`);

  return `<span class="theatre-card-git-stats theatre-card-git-stats--clickable" title="View uncommitted changes">${parts.join(' ')}</span>`;
}
