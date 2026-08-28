import type { ContextMenuEntry } from '../ui/ContextMenu';
import type { SandboxProviderId, TaskStatus } from '../../types';
import { SANDBOX_BACKEND_LABELS } from '../../types';
import { FILE_MANAGER_NAME } from '../../utils/fileManager';

/** Column display names, as the "Move to" menu and its toasts write them. */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

/** Callers supply the handlers and add their own entries around these. */
export interface TaskMenuActions {
  /** Open a new terminal for the task; a provider opens it sandboxed. */
  openTerminal: (provider?: SandboxProviderId) => void;
  openEditor: () => void;
  /** Reveal the task's worktree in the OS file manager. */
  openFolder: () => void;
  setStatus: (status: TaskStatus) => void;
  /**
   * Finish the task: runs the done hook + closes its terminals, matching
   * drag-to-Done. When omitted (e.g. bulk selection), "Done" falls back to a
   * plain status write.
   */
  completeToDone?: () => void;
  trash: () => void;
}

/**
 * "Open in ▸" — a host Terminal, one entry per installed sandbox backend,
 * Editor, and the OS file manager. Everything but the terminal opens the
 * worktree, so it only appears once the task has one.
 */
export function openInEntry(
  sandboxProviders: SandboxProviderId[],
  hasWorktree: boolean,
  actions: TaskMenuActions,
): ContextMenuEntry {
  const submenu: ContextMenuEntry[] = [{ label: 'Terminal', icon: 'terminal', onClick: () => actions.openTerminal() }];
  if (hasWorktree) {
    for (const provider of sandboxProviders) {
      if (provider === 'none') continue;
      submenu.push({
        label: `${SANDBOX_BACKEND_LABELS[provider]} sandbox`,
        icon: 'cube',
        onClick: () => actions.openTerminal(provider),
      });
    }
    submenu.push({ label: 'Editor', icon: 'code', onClick: actions.openEditor });
    submenu.push({ label: FILE_MANAGER_NAME, icon: 'folder-open', onClick: actions.openFolder });
  }
  return { label: 'Open in', submenu };
}

/** Returns nothing when the GitHub feature is off for the project. */
export interface GithubMenuActions {
  openPullRequest: (prNumber: number) => void;
  createPullRequest: () => void;
}

export function githubEntries(
  options: { enabled: boolean; prNumber?: number; hasBranch: boolean },
  actions: GithubMenuActions,
): ContextMenuEntry[] {
  if (!options.enabled) return [];

  if (options.prNumber != null) {
    const prNumber = options.prNumber;
    return [
      {
        label: `Pull request #${prNumber}`,
        icon: 'git-pull-request',
        onClick: () => actions.openPullRequest(prNumber),
      },
    ];
  }

  if (!options.hasBranch) return [];
  return [{ label: 'Create pull request', icon: 'git-pull-request', onClick: actions.createPullRequest }];
}

/** "Move to ▸" — the four columns, then a danger Trash. */
export function moveToEntry(
  actions: Pick<TaskMenuActions, 'setStatus' | 'completeToDone' | 'trash'>,
): ContextMenuEntry {
  return {
    label: 'Move to',
    submenu: [
      { label: STATUS_LABELS.todo, onClick: () => actions.setStatus('todo') },
      { label: STATUS_LABELS.in_progress, onClick: () => actions.setStatus('in_progress') },
      { label: STATUS_LABELS.in_review, onClick: () => actions.setStatus('in_review') },
      { label: STATUS_LABELS.done, onClick: actions.completeToDone ?? (() => actions.setStatus('done')) },
      { separator: true },
      { label: 'Trash', icon: 'trash', danger: true, onClick: actions.trash },
    ],
  };
}
