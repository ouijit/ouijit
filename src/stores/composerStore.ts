import { create } from 'zustand';

/**
 * The new-task draft, and whether its expanded sheet is up.
 *
 * The draft lives here rather than inside the column composer because it
 * outlives that component: ⌘N away from the board opens the sheet on its own,
 * and whatever you leave unfinished is waiting in the column's resting row
 * when you come back to it. One draft, whichever surface you reached it from.
 */
interface ComposerStore {
  draft: { name: string; description: string };
  /** The expanded sheet is open. Rendered by the board when it's mounted, by
   *  the project view when it isn't. */
  sheetOpen: boolean;
  /** Caret offset the sheet opens at, handed over by the inline editor. */
  sheetCaret: number | null;

  setName: (name: string) => void;
  setDescription: (description: string) => void;
  clearDraft: () => void;
  openSheet: (caret?: number | null) => void;
  closeSheet: () => void;
}

export const useComposerStore = create<ComposerStore>()((set) => ({
  draft: { name: '', description: '' },
  sheetOpen: false,
  sheetCaret: null,

  setName: (name) => set((s) => ({ draft: { ...s.draft, name } })),

  setDescription: (description) => set((s) => ({ draft: { ...s.draft, description } })),

  clearDraft: () => set({ draft: { name: '', description: '' } }),

  openSheet: (caret = null) => set({ sheetOpen: true, sheetCaret: caret }),

  closeSheet: () => set({ sheetOpen: false, sheetCaret: null }),
}));

/** True when the board is on screen, so the column composer exists to focus. */
export function isBoardMounted(activePanel: string, kanbanVisible: boolean): boolean {
  return activePanel !== 'settings' && kanbanVisible;
}
