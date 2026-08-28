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

/** Asks for an editor. Null is the user backing out of the dialog. */
async function requestEditor(projectPath: string, existingHook?: ScriptHook): Promise<string | null> {
  const saved = await useUIStore.getState().requestEditorHook({ projectPath, existingHook });
  return saved?.command ?? null;
}

/**
 * The command to open a worktree with, asked for when none is registered.
 * Resolved before anything is created: a task the user backs out of opening
 * should not have been started.
 */
async function editorCommand(projectPath: string): Promise<string | null> {
  const { editor } = await window.api.hooks.get(projectPath);
  if (editor?.command) return editor.command;
  return requestEditor(projectPath);
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
    if (await requestEditor(projectPath)) await openFileInEditor(projectPath, workspaceRoot, filePath, line);
    return;
  }

  if (result.reason === 'missing-file') {
    addToast(`${basename(filePath)} no longer exists`, 'error');
    return;
  }

  addToast(`${result.editor} could not open ${basename(filePath)}`, {
    type: 'error',
    // The action is the point of this toast, so it waits to be answered.
    persistent: true,
    actionLabel: 'Change editor',
    onAction: () => {
      void window.api.hooks.get(projectPath).then(async (hooks) => {
        if (await requestEditor(projectPath, hooks.editor)) {
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
  const command = await editorCommand(projectPath);
  if (command) await openWorktreeEditor(projectPath, worktree, taskId, command);
}

/** Creates the task's worktree first, the way "Open in Terminal" does. */
export async function openTaskInEditor(projectPath: string, task: TaskWithWorkspace): Promise<void> {
  const command = await editorCommand(projectPath);
  if (!command) return;

  const worktree = await ensureTaskWorktree(projectPath, task);
  if (worktree) await openWorktreeEditor(projectPath, worktree, task.taskNumber, command);
}
