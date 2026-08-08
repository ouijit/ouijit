import { focusKanbanAddInput } from '../components/kanban/KanbanAddInput';
import { useComposerStore, isBoardMounted } from '../stores/composerStore';
import { useProjectStore } from '../stores/projectStore';

/**
 * The single entry point for "new task", behind ⌘N and the title bar button.
 *
 * On the board, the composer is already on screen, so this just focuses it —
 * the new task lands where you can see it. Anywhere else, the expanded sheet
 * opens over whatever you were doing instead of switching the view out from
 * under you. Both write the same draft, so leaving one and arriving at the
 * other picks up where you left off.
 */
export function openTaskComposer(): void {
  const { activePanel, kanbanVisible } = useProjectStore.getState();

  if (isBoardMounted(activePanel, kanbanVisible)) {
    focusKanbanAddInput();
    return;
  }

  useComposerStore.getState().openSheet();
}
