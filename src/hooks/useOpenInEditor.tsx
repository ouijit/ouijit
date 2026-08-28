import { useCallback, useState, type ReactNode } from 'react';
import type { ScriptHook } from '../types';
import { basename } from '../analysis/paths';
import { useProjectStore } from '../stores/projectStore';
import { HookConfigDialog } from '../components/dialogs/HookConfigDialog';

interface OpenInEditor {
  openFile: (filePath: string, line?: number) => void;
  /** Render inside the caller's tree: the editor setup dialog, or null. */
  editorDialog: ReactNode;
}

/** The file a click asked for, held while the editor behind it is sorted out. */
interface PendingOpen {
  filePath: string;
  line?: number;
  /** The command that just failed, so the dialog opens on it rather than blank. */
  existingHook?: ScriptHook;
}

/**
 * "Open in editor" for a file reference, with its failure paths attached: no
 * editor registered goes straight to the setup dialog, a launch that fails
 * offers the command it tried for editing, and either way the file opens as
 * soon as there is an editor that can open it.
 */
export function useOpenInEditor(projectPath: string, workspaceRoot: string): OpenInEditor {
  const [pending, setPending] = useState<PendingOpen | null>(null);

  const openFile = useCallback(
    (filePath: string, line?: number) => {
      void window.api.openFileInEditor(projectPath, workspaceRoot, filePath, line).then((result) => {
        if (result.success) return;
        if (result.reason === 'no-editor') {
          setPending({ filePath, line });
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
            void window.api.hooks
              .get(projectPath)
              .then((hooks) => setPending({ filePath, line, existingHook: hooks.editor })),
        });
      });
    },
    [projectPath, workspaceRoot],
  );

  const editorDialog = pending ? (
    <HookConfigDialog
      projectPath={projectPath}
      hookType="editor"
      existingHook={pending.existingHook}
      onClose={(result) => {
        const retry = pending;
        setPending(null);
        // An empty command deletes the hook, so there is nothing to retry with.
        if (!result?.hook?.command) return;
        useProjectStore.getState().markHookConfigured('editor');
        openFile(retry.filePath, retry.line);
      }}
    />
  ) : null;

  return { openFile, editorDialog };
}
