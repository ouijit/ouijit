import { useCallback, useEffect } from 'react';
import { TaskComposerSheet } from './TaskComposerSheet';
import { useAppStore } from '../../stores/appStore';
import { useComposerStore, isBoardMounted } from '../../stores/composerStore';
import { useProjectStore } from '../../stores/projectStore';
import { resolveAttachmentPath } from '../../utils/taskAttachments';

/**
 * The composer sheet as its own surface, for ⌘N away from the board.
 *
 * When the board is up, its column composer owns the sheet instead, so exactly
 * one of the two renders it and both read the same draft. Creating from here
 * goes straight to the API, since there is no board to hand the task to.
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
    // Close first so the sheet doesn't sit there through the round trip, but
    // hold the draft until the task actually exists — losing a written prompt
    // to a failed IPC call is the one outcome worth guarding against.
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
      // Nothing to hand a caret back to out here; the draft is kept either way
      // and the column composer picks it up when you next open the board.
      onCollapse={() => useComposerStore.getState().closeSheet()}
      onDiscard={discard}
    />
  );
}
