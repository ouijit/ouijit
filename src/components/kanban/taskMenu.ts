import type { ContextMenuEntry } from '../ui/ContextMenu';
import type { SandboxProviderId, TaskStatus, TaskWithWorkspace } from '../../types';
import { SANDBOX_BACKEND_LABELS } from '../../types';
import { FILE_MANAGER_NAME } from '../../utils/fileManager';
import { openPullRequestInPanel, createPullRequestForTask } from '../../services/githubTaskActions';
import { openLinearIssueInPanel, unlinkLinearIssue } from '../../services/linearTaskActions';

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
 * "Open in ▸" — a Terminal, one entry per available sandbox backend, Editor,
 * and the OS file manager. Terminals and Editor create the worktree a task has
 * never had; the file manager needs one already on disk.
 */
export function openInEntry(
  sandboxProviders: SandboxProviderId[],
  hasWorktree: boolean,
  actions: TaskMenuActions,
): ContextMenuEntry {
  const submenu: ContextMenuEntry[] = [{ label: 'Terminal', icon: 'terminal', onClick: () => actions.openTerminal() }];
  for (const provider of sandboxProviders) {
    if (provider === 'none') continue;
    submenu.push({
      label: `${SANDBOX_BACKEND_LABELS[provider]} sandbox`,
      icon: 'cube',
      onClick: () => actions.openTerminal(provider),
    });
  }
  submenu.push({ label: 'Editor', icon: 'code', onClick: actions.openEditor });
  if (hasWorktree) {
    submenu.push({ label: FILE_MANAGER_NAME, icon: 'folder-open', onClick: actions.openFolder });
  }
  return { label: 'Open in', submenu };
}

/**
 * What the task's trackers offer, separated from the entries above it. Empty
 * when neither has anything to say, so the separator does not end the menu.
 */
export function trackerEntries(
  projectPath: string,
  task: TaskWithWorkspace | undefined,
  enabled: { github: boolean; linear: boolean },
): ContextMenuEntry[] {
  if (!task) return [];
  const entries: ContextMenuEntry[] = [];

  const prNumber = task.githubPrNumber;
  if (enabled.github && prNumber != null) {
    entries.push({
      label: `Pull request #${prNumber}`,
      icon: 'git-pull-request',
      onClick: () => openPullRequestInPanel(projectPath, prNumber),
    });
  } else if (enabled.github && task.branch) {
    entries.push({
      label: 'Create pull request',
      icon: 'git-pull-request',
      onClick: () => void createPullRequestForTask(projectPath, task),
    });
  }

  const issueId = task.linearIssueId;
  if (enabled.linear && issueId && task.linearIssueIdentifier) {
    entries.push(
      {
        label: task.linearIssueIdentifier,
        icon: 'circle-dashed',
        onClick: () => openLinearIssueInPanel(projectPath, issueId),
      },
      { label: 'Unlink issue', icon: 'x', onClick: () => void unlinkLinearIssue(projectPath, task.taskNumber) },
    );
  }

  return entries.length > 0 ? [{ separator: true }, ...entries] : [];
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
