import { useCallback, useState, type ReactNode } from 'react';
import type { ScriptHook, WorktreeInfo } from '../types';
import { basename } from '../analysis/paths';
import { useProjectStore } from '../stores/projectStore';
import { openWorktreeEditor } from '../components/terminal/terminalActions';
import { HookConfigDialog } from '../components/dialogs/HookConfigDialog';

interface OpenInEditor {
  /** Open one file, at a line if there is one. */
  openFile: (filePath: string, line?: number) => void;
  /** Open a task's whole worktree. */
  openWorktree: (worktree: WorktreeInfo, taskId?: number) => void;
  /** Render inside the caller's tree: the editor setup dialog, or null. */
  editorDialog: ReactNode;
}

/** What the click asked for, held while the editor behind it is sorted out. */
interface PendingOpen {
  retry: () => void;
  /** The command that just failed, so the dialog opens on it rather than blank. */
  existingHook?: ScriptHook;
}

/**
 * Every "open in editor" in the app: a file reference, or a task's worktree.
 *
 * The two open differently — a file goes to launch-editor for the line jump, a
 * worktree runs the editor hook in a task terminal so Helix and Vim get a TTY —
 * but they fail the same way, so what happens next lives here. No editor
 * registered opens the setup dialog, a launch that fails names the editor it
 * tried and offers that command for editing, and either way the click is
 * carried out as soon as there is an editor that can carry it out.
 */
export function useOpenInEditor(projectPath: string, workspaceRoot: string): OpenInEditor {
  const [pending, setPending] = useState<PendingOpen | null>(null);

  const openFile = useCallback(
    (filePath: string, line?: number) => {
      void window.api.openFileInEditor(projectPath, workspaceRoot, filePath, line).then((result) => {
        if (result.success) return;
        if (result.reason === 'no-editor') {
          setPending({ retry: () => openFile(filePath, line) });
          return;
        }
        const { addToast } = useProjectStore.getState();
        if (result.reason === 'missing-file') {
          addToast(`${basename(filePath)} no longer exists`, 'error');
          return;
        }
        addToast(`${result.editor} could not open ${basename(filePath)}`, {
          type: 'error',
          actionLabel: 'Change editor',
          onAction: () =>
            void window.api.hooks.get(projectPath).then((hooks) =>
              setPending({
                retry: () => openFile(filePath, line),
                existingHook: hooks.editor,
              }),
            ),
        });
      });
    },
    [projectPath, workspaceRoot],
  );

  const openWorktree = useCallback(
    (worktree: WorktreeInfo, taskId?: number) => {
      void openWorktreeEditor(projectPath, worktree, taskId).then((opened) => {
        if (!opened) setPending({ retry: () => openWorktree(worktree, taskId) });
      });
    },
    [projectPath],
  );

  const editorDialog = pending ? (
    <HookConfigDialog
      projectPath={projectPath}
      hookType="editor"
      existingHook={pending.existingHook}
      onClose={(result) => {
        const { retry } = pending;
        setPending(null);
        // An empty command deletes the hook, so there is nothing to retry with.
        if (!result?.hook?.command) return;
        retry();
      }}
    />
  ) : null;

  return { openFile, openWorktree, editorDialog };
}
