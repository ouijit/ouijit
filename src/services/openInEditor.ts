import type { ScriptHook, TaskWithWorkspace, WorktreeInfo } from '../types';
import { basename } from '../analysis/paths';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { ensureTaskWorktree } from '../components/navigation';
import { openWorktreeEditor } from '../components/terminal/terminalActions';

/**
 * Every "open in editor" in the app: a file reference, a task, or a worktree
 * already in hand.
 *
 * The two ways they open differ — a file goes to launch-editor for the line
 * jump, a worktree runs the editor hook in a task terminal so Helix and Vim get
 * a TTY — but both can find no editor registered, which is what lives here:
 * ask for one, and carry the request out once it is saved. Only a file open
 * reports why a launch failed; a worktree open leaves that to the terminal it
 * spawned, which shows the shell's own error.
 */

/** The dialog answers with the hook it saved, or null if the user backed out. */
async function registerEditor(projectPath: string, existingHook?: ScriptHook): Promise<boolean> {
  const saved = await useUIStore.getState().requestEditorHook({ projectPath, existingHook });
  return !!saved?.command;
}

export async function openFileInEditor(
  projectPath: string,
  workspaceRoot: string,
  filePath: string,
  line?: number,
): Promise<void> {
  const result = await window.api.openFileInEditor(projectPath, workspaceRoot, filePath, line);
  if (result.success) return;

  const { addToast } = useProjectStore.getState();

  if (result.reason === 'no-editor') {
    if (await registerEditor(projectPath)) await openFileInEditor(projectPath, workspaceRoot, filePath, line);
    return;
  }

  if (result.reason === 'missing-file') {
    addToast(`${basename(filePath)} no longer exists`, 'error');
    return;
  }

  addToast(`${result.editor} could not open ${basename(filePath)}`, {
    type: 'error',
    actionLabel: 'Change editor',
    onAction: () => {
      void window.api.hooks.get(projectPath).then(async (hooks) => {
        if (await registerEditor(projectPath, hooks.editor)) {
          await openFileInEditor(projectPath, workspaceRoot, filePath, line);
        }
      });
    },
  });
}

export async function openWorktreeInEditor(
  projectPath: string,
  worktree: WorktreeInfo,
  taskId?: number,
): Promise<void> {
  if (await openWorktreeEditor(projectPath, worktree, taskId)) return;
  if (await registerEditor(projectPath)) await openWorktreeEditor(projectPath, worktree, taskId);
}

/** Creates the task's worktree first, the way "Open in Terminal" does. */
export async function openTaskInEditor(projectPath: string, task: TaskWithWorkspace): Promise<void> {
  const worktree = await ensureTaskWorktree(projectPath, task);
  if (worktree) await openWorktreeInEditor(projectPath, worktree, task.taskNumber);
}
