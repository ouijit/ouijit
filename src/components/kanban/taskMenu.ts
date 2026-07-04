import type { ContextMenuEntry } from '../ui/ContextMenu';
import type { SandboxProviderId } from '../../types';

/** The four kanban columns a task can be moved between. */
export type MoveStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export const SANDBOX_PROVIDER_LABELS: Record<SandboxProviderId, string> = {
  none: 'Off',
  lima: 'Lima VM',
  nono: 'nono',
};

/** Column display names, shared by the "Move to" menu and its toasts. */
export const STATUS_LABELS: Record<MoveStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

/**
 * The task actions shared by the kanban card menu and a task terminal's header
 * menu, so the two can't drift. Callers supply the handlers (they open
 * terminals / move status through different plumbing) and compose these entries
 * with their own context-specific items around them.
 */
export interface TaskMenuActions {
  /** Open a new terminal for the task; a provider opens it sandboxed. */
  openTerminal: (provider?: SandboxProviderId) => void;
  openEditor: () => void;
  setStatus: (status: MoveStatus) => void;
  trash: () => void;
}

/** "Open in ▸" — a host Terminal, one entry per installed sandbox backend, Editor. */
export function openInEntry(
  sandboxProviders: SandboxProviderId[],
  hasWorktree: boolean,
  actions: TaskMenuActions,
): ContextMenuEntry {
  const submenu: ContextMenuEntry[] = [{ label: 'Terminal', icon: 'terminal', onClick: () => actions.openTerminal() }];
  if (hasWorktree) {
    for (const provider of sandboxProviders) {
      submenu.push({
        label: `${SANDBOX_PROVIDER_LABELS[provider]} sandbox`,
        icon: 'cube',
        onClick: () => actions.openTerminal(provider),
      });
    }
  }
  submenu.push({ label: 'Editor', icon: 'code', onClick: actions.openEditor });
  return { label: 'Open in', submenu };
}

/** "Move to ▸" — the four columns, then a danger Trash. */
export function moveToEntry(actions: TaskMenuActions): ContextMenuEntry {
  return {
    label: 'Move to',
    submenu: [
      { label: STATUS_LABELS.todo, onClick: () => actions.setStatus('todo') },
      { label: STATUS_LABELS.in_progress, onClick: () => actions.setStatus('in_progress') },
      { label: STATUS_LABELS.in_review, onClick: () => actions.setStatus('in_review') },
      { label: STATUS_LABELS.done, onClick: () => actions.setStatus('done') },
      { separator: true },
      { label: 'Trash', icon: 'trash', danger: true, onClick: actions.trash },
    ],
  };
}
