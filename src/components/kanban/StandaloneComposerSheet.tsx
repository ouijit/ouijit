import { useCallback, useEffect } from 'react';
import { TaskComposerSheet } from './TaskComposerSheet';
import { useAppStore } from '../../stores/appStore';
import { useComposerStore, isBoardMounted } from '../../stores/composerStore';
import { useProjectStore } from '../../stores/projectStore';
import { resolveAttachmentPath } from '../../utils/taskAttachments';

/**
 * The composer sheet for ⌘N away from the board. When the board is up its
 * column composer owns the sheet instead, so exactly one renders it and both
 * read the same draft. Creating here goes straight to the API.
 */
export function StandaloneComposerSheet({ projectPath }: { projectPath: string }) {
  const kanbanVisible = useProjectStore((s) => s.kanbanVisible);
  const activePanel = useProjectStore((s) => s.activePanel);
  const sheetOpen = useComposerStore((s) => s.sheetOpen);
  const name = useComposerStore((s) => s.draft.name);
  const description = useComposerStore((s) => s.draft.description);

  const boardMounted = isBoardMounted(activePanel, kanbanVisible);
  const owned = sheetOpen && !boardMounted;

  // The board's Escape handler stands down while a composer sheet is up.
  useEffect(() => {
    if (!owned) return;
    useAppStore.getState().openComposerSheet();
    return () => useAppStore.getState().closeComposerSheet();
  }, [owned]);

  const create = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedDescription = description.trim();
    // Close first, but hold the draft until the task exists, or a failed IPC
    // call loses what was written.
    useComposerStore.getState().closeSheet();
    try {
      const result = await window.api.task.create(projectPath, trimmedName, trimmedDescription || undefined);
      if (!result?.success) throw new Error(result?.error ?? 'Failed to create task');
      useComposerStore.getState().clearDraft();
      void useProjectStore.getState().loadTasks(projectPath);
    } catch (error) {
      useProjectStore.getState().addToast(error instanceof Error ? error.message : 'Failed to create task', 'error');
    }
  }, [name, description, projectPath]);

  const discard = useCallback(() => {
    const composer = useComposerStore.getState();
    composer.clearDraft();
    composer.closeSheet();
  }, []);

  if (!owned) return null;

  return (
    <TaskComposerSheet
      mode="create"
      name={name}
      description={description}
      onNameChange={useComposerStore.getState().setName}
      onDescriptionChange={useComposerStore.getState().setDescription}
      onAttachFile={resolveAttachmentPath}
      onSubmit={create}
      // No inline editor out here to hand the caret back to; the draft is kept
      // and the column composer picks it up.
      onCollapse={() => useComposerStore.getState().closeSheet()}
      onDiscard={discard}
    />
  );
}
