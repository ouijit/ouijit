import type { ContextMenuEntry } from '../ui/ContextMenu';
import type { SandboxBackendId, SandboxProviderId, TaskStatus, TaskWithWorkspace } from '../../types';
import { SANDBOX_LABELS } from '../../types';
import type { TerminalDisplayState } from '../../stores/terminalDisplay';
import { useProjectStore } from '../../stores/projectStore';
import { getProjectConfig, loadTasks } from '../../stores/projectDataStore';
import { completeTask } from '../../services/taskCompletion';
import { openTaskInEditor } from '../../services/openInEditor';
import { FILE_MANAGER_NAME, revealInFileManager } from '../../utils/fileManager';
import { terminalInstances } from '../terminal/terminalRegistry';
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
  /** Open a new terminal for the task, overriding the continue hook's sandbox. */
  openTerminal: (provider: SandboxProviderId) => void;
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
 * "Open in ▸" — a Terminal for each place one can run, the project default
 * first, then Editor and the OS file manager. Terminals and Editor create the worktree a task has
 * never had; the file manager needs one already on disk.
 */
export function openInEntry(
  sandboxProviders: SandboxBackendId[],
  hasWorktree: boolean,
  actions: TaskMenuActions,
  projectDefault: SandboxProviderId,
): ContextMenuEntry {
  const places: SandboxProviderId[] = ['none', ...sandboxProviders];
  places.sort((a, b) => Number(b === projectDefault) - Number(a === projectDefault));
  const submenu: ContextMenuEntry[] = places.map((place) => ({
    label: `${SANDBOX_LABELS[place]} terminal`,
    icon: 'terminal',
    onClick: () => actions.openTerminal(place),
  }));
  submenu.push({ separator: true });
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

export interface TaskMenuContext {
  projectPath: string;
  task: TaskWithWorkspace;
  sandboxProviders: SandboxBackendId[];
  /** The task's terminals, for View Plan. */
  terminals: TerminalDisplayState[];
  trackers: { github: boolean; linear: boolean };
  openTerminal: (provider: SandboxProviderId) => void;
  showTerminal: (ptyId: string) => void;
  branchFrom: () => void;
  rename: () => void;
}

/** One task's menu, the same wherever the task is shown. */
export function taskEntries(ctx: TaskMenuContext): ContextMenuEntry[] {
  const { projectPath, task } = ctx;
  const items: ContextMenuEntry[] = [];

  const actions: TaskMenuActions = {
    openTerminal: ctx.openTerminal,
    openEditor: () => void openTaskInEditor(projectPath, task),
    openFolder: () => void revealInFileManager(task.worktreePath!),
    setStatus: async (status) => {
      await window.api.task.setStatus(projectPath, task.taskNumber, status);
      loadTasks(projectPath);
    },
    completeToDone: () => void completeTask({ projectPath, task }),
    trash: async () => {
      await window.api.task.trash(projectPath, task.taskNumber);
      loadTasks(projectPath);
      useProjectStore.getState().addToast('Task moved to trash', 'success');
    },
  };
  items.push(
    openInEntry(
      ctx.sandboxProviders,
      !!(task.worktreePath && task.branch),
      actions,
      getProjectConfig(ctx.projectPath)?.defaultSandbox ?? 'none',
    ),
  );

  const planDisplay = ctx.terminals.find((d) => d.panels.some((p) => p.kind === 'plan'));
  if (planDisplay) {
    items.push({
      label: 'View Plan',
      icon: 'list-checks',
      onClick: () => {
        ctx.showTerminal(planDisplay.ptyId);
        const inst = terminalInstances.get(planDisplay.ptyId);
        const planPanel = inst?.panels.find((p) => p.kind === 'plan');
        if (inst && planPanel) inst.activatePanel(planPanel.id);
      },
    });
  }

  items.push({ separator: true });
  items.push(moveToEntry(actions));
  if (task.branch && task.status !== 'done') {
    items.push({ label: 'Branch from this task', icon: 'git-branch', onClick: ctx.branchFrom });
  }
  items.push({ label: 'Rename', icon: 'pencil-simple', onClick: ctx.rename });
  items.push(...trackerEntries(projectPath, task, ctx.trackers));
  return items;
}
