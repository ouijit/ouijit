import type { ContextMenuEntry, ContextMenuItem } from '../ui/ContextMenu';
import type { SandboxBackendId, SandboxProviderId, TaskStatus, TaskWithWorkspace } from '../../types';
import { SANDBOX_LABELS } from '../../types';
import type { TerminalDisplayState } from '../../stores/terminalDisplay';
import { useProjectStore } from '../../stores/projectStore';
import { getProjectConfig, loadTasks } from '../../stores/projectDataStore';
import { completeTask } from '../../services/taskCompletion';
import { openTaskInEditor } from '../../services/openInEditor';
import { FILE_MANAGER_NAME, revealInFileManager } from '../../utils/fileManager';
import { terminalInstances } from '../terminal/terminalRegistry';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { tasksOpenAsChat } from '../../services/chatSettings';
import type { TaskChatSummary } from '../../chat/model';
import type { TaskSurface } from '../../chat/preferences';
import {
  openPullRequestInPanel,
  createPullRequestForTask,
  openGithubIssueInPanel,
  unlinkGithubIssue,
} from '../../services/githubTaskActions';
import { openLinearIssueInPanel, unlinkLinearIssue } from '../../services/linearTaskActions';

/** Column display names, as the "Move to" menu and its toasts write them. */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

const CHAT_LABEL_LENGTH = 48;

/** A chat named by the first thing asked in it: its first line, cut at a word to fit a menu. */
export function chatLabel(text: string): string {
  const line = text.trim().split('\n')[0];
  if (line.length <= CHAT_LABEL_LENGTH) return line;
  const cut = line.slice(0, CHAT_LABEL_LENGTH);
  const word = cut.lastIndexOf(' ');
  return word > CHAT_LABEL_LENGTH / 2 ? cut.slice(0, word) : cut;
}

/** Of a project's task chats, the ones of this task that no card has open. */
export function closedTaskChats(chats: TaskChatSummary[] | undefined, taskNumber: number): TaskChatSummary[] {
  return (chats ?? []).filter((chat) => chat.taskId === taskNumber && !terminalInstances.has(chat.id));
}

/** Callers supply the handlers and add their own entries around these. */
export interface TaskMenuActions {
  /** Open the task in that place, as a terminal or a chat by preference, overriding the continue hook's sandbox. */
  openTerminal: (provider: SandboxProviderId) => void;
  /** Add a new chat, or a plain terminal, in that place beside what the task already has. */
  openSession?: (surface: TaskSurface, provider: SandboxProviderId) => void;
  /** The task's chats that are not open as a card, newest first, and how to open one again. */
  earlierChats?: { chats: TaskChatSummary[]; open: (chat: TaskChatSummary) => void };
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

function placeIcon(place: SandboxProviderId): string {
  return place === 'none' ? 'desktop' : 'shield-check';
}

function inPlace(place: SandboxProviderId): string {
  return place === 'none' ? 'on Host' : `in ${SANDBOX_LABELS[place]}`;
}

/**
 * The places other than the project's default. One place is a row of its
 * own; more are rows under one. A place offering a single entry is that entry
 * named with the place, rather than a submenu of one.
 */
function placesEntry(
  places: SandboxProviderId[],
  sessions: (place: SandboxProviderId) => ContextMenuItem[],
): ContextMenuEntry {
  const single = sessions(places[0]).length === 1;
  if (places.length === 1) {
    const [place] = places;
    const capital = inPlace(place).replace(/^./, (c) => c.toUpperCase());
    if (!single) return { label: capital, icon: placeIcon(place), submenu: sessions(place) };
    const [only] = sessions(place);
    return { ...only, label: `${only.label} ${inPlace(place)}`, icon: placeIcon(place) };
  }
  if (single) {
    const label = sessions(places[0])[0].label;
    return {
      label: `${label} in`,
      icon: 'shield-check',
      submenu: places.map((place) => ({ ...sessions(place)[0], label: SANDBOX_LABELS[place], icon: placeIcon(place) })),
    };
  }
  return {
    label: places.includes('none') ? 'Elsewhere' : 'In a sandbox',
    icon: 'shield-check',
    submenu: places.map((place) => ({
      label: SANDBOX_LABELS[place],
      icon: placeIcon(place),
      submenu: sessions(place),
    })),
  };
}

/**
 * Resume, with New chat and New terminal where chat offers them, in the
 * project's default place; the other places offer the same behind a row.
 */
export function openEntries(
  sandboxProviders: SandboxBackendId[],
  hasWorktree: boolean,
  actions: TaskMenuActions,
  projectDefault: SandboxProviderId,
  started = true,
  opensAsChat = false,
): ContextMenuEntry[] {
  const chat = useHomeChatStore.getState().enabled;
  const sessions = (place: SandboxProviderId): ContextMenuItem[] => {
    const list: ContextMenuItem[] = [
      { label: started ? 'Resume' : 'Start', icon: 'play', onClick: () => actions.openTerminal(place) },
    ];
    const open = actions.openSession;
    if (chat && open && started) {
      list.push({ label: 'New chat', icon: 'chat-circle', onClick: () => open('chat', place) });
      // Resuming opens a terminal anyway where tasks open in one.
      if (opensAsChat) {
        list.push({ label: 'New terminal', icon: 'terminal', onClick: () => open('terminal', place) });
      }
    }
    return list;
  };

  const entries: ContextMenuEntry[] = sessions(projectDefault);
  const earlier = actions.earlierChats;
  if (chat && earlier && earlier.chats.length > 0) {
    entries.push({
      label: 'Earlier chats',
      icon: 'clock-counter-clockwise',
      submenu: earlier.chats.map((past) => ({
        label: chatLabel(past.firstMessage),
        onClick: () => earlier.open(past),
      })),
    });
  }

  const elsewhere = (['none', ...sandboxProviders] as SandboxProviderId[]).filter((place) => place !== projectDefault);
  if (elsewhere.length > 0) entries.push(placesEntry(elsewhere, sessions));
  const apps: ContextMenuEntry[] = [{ label: 'Editor', icon: 'code', onClick: actions.openEditor }];
  if (hasWorktree) apps.push({ label: FILE_MANAGER_NAME, icon: 'folder-open', onClick: actions.openFolder });
  entries.push({ separator: true }, { label: 'Open in', icon: 'arrow-square-out', submenu: apps });
  return entries;
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

  const issueNumber = task.githubIssueNumber;
  if (enabled.github && issueNumber != null) {
    entries.push(
      {
        label: `Issue #${issueNumber}`,
        icon: 'circle-dashed',
        onClick: () => openGithubIssueInPanel(projectPath, issueNumber),
      },
      { label: 'Unlink issue', icon: 'x', onClick: () => void unlinkGithubIssue(projectPath, task.taskNumber) },
    );
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
    icon: 'kanban',
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
  openSession: (surface: TaskSurface, provider: SandboxProviderId) => void;
  /** The project's task chats, as the chat store lists them. */
  chats: TaskChatSummary[] | undefined;
  openChat: (chat: TaskChatSummary) => void;
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
    openSession: ctx.openSession,
    earlierChats: { chats: closedTaskChats(ctx.chats, task.taskNumber), open: ctx.openChat },
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
    ...openEntries(
      ctx.sandboxProviders,
      !!(task.worktreePath && task.branch),
      actions,
      getProjectConfig(ctx.projectPath)?.defaultSandbox ?? 'none',
      task.status !== 'todo',
      tasksOpenAsChat(ctx.projectPath),
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
