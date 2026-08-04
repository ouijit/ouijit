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
    useAppStore.getState().setComposerSheetOpen(owned);
    return () => useAppStore.getState().setComposerSheetOpen(false);
  }, [owned]);

  const create = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedDescription = description.trim();
    const composer = useComposerStore.getState();
    composer.clearDraft();
    composer.closeSheet();
    await window.api.task.create(projectPath, trimmedName, trimmedDescription || undefined);
    void useProjectStore.getState().loadTasks(projectPath);
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
