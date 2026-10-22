import { focusKanbanAddInput } from '../components/kanban/KanbanAddInput';
import { useComposerStore } from '../stores/composerStore';
import { useAppStore, selectBoardOnScreen } from '../stores/appStore';

/**
 * "New task" behind ⌘N and the title bar button. A project other than the one
 * on screen always gets the sheet.
 *
 * On the board, the composer is already on screen, so this just focuses it —
 * the new task lands where you can see it. Anywhere else, the expanded sheet
 * opens over whatever you were doing instead of switching the view out from
 * under you. Both write the same draft, so leaving one and arriving at the
 * other picks up where you left off.
 */
export function openTaskComposer(projectPath?: string): void {
  const app = useAppStore.getState();
  if (projectPath && projectPath !== app.activeProjectPath) {
    useComposerStore.getState().openSheet(null, projectPath);
    return;
  }
  if (selectBoardOnScreen(app)) {
    focusKanbanAddInput();
    return;
  }

  useComposerStore.getState().openSheet();
}

/** The sheet for a project, even over that project's own board. */
export function openTaskSheet(projectPath: string): void {
  useComposerStore.getState().openSheet(null, projectPath);
}
