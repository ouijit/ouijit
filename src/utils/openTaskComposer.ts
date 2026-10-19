import { focusKanbanAddInput } from '../components/kanban/KanbanAddInput';
import { useComposerStore } from '../stores/composerStore';
import { useAppStore, selectBoardOnScreen } from '../stores/appStore';

/**
 * The single entry point for "new task", behind ⌘N, the title bar button and
 * the sidebar's project rows. A project other than the one on screen always
 * gets the sheet.
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
