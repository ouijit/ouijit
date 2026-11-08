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
   *  the main view when it isn't. */
  sheetOpen: boolean;
  /** Caret offset the sheet opens at, handed over by the inline editor. */
  sheetCaret: number | null;
  /** The project the sheet creates in, when it is not the one on screen. */
  sheetProjectPath: string | null;

  setName: (name: string) => void;
  setDescription: (description: string) => void;
  clearDraft: () => void;
  openSheet: (caret?: number | null, projectPath?: string | null) => void;
  closeSheet: () => void;
  /** Point the open sheet at another project, keeping the draft. */
  retarget: (projectPath: string) => void;
}

export const useComposerStore = create<ComposerStore>()((set) => ({
  draft: { name: '', description: '' },
  sheetOpen: false,
  sheetCaret: null,
  sheetProjectPath: null,

  setName: (name) => set((s) => ({ draft: { ...s.draft, name } })),

  setDescription: (description) => set((s) => ({ draft: { ...s.draft, description } })),

  clearDraft: () => set({ draft: { name: '', description: '' } }),

  openSheet: (caret = null, projectPath = null) =>
    set({ sheetOpen: true, sheetCaret: caret, sheetProjectPath: projectPath }),

  closeSheet: () => set({ sheetOpen: false, sheetCaret: null, sheetProjectPath: null }),

  retarget: (projectPath) => set({ sheetProjectPath: projectPath }),
}));
