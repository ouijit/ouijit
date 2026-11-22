import { create } from 'zustand';

interface AddPanelMenuState {
  /** Whose menu is open, and where: below the button that opened it. */
  open: { ptyId: string; x: number; y: number } | null;
  show: (ptyId: string, anchor: Element) => void;
  close: () => void;
}

/**
 * The menu that adds a panel, opened from wherever a "+" sits: a card's pane
 * header or its tab bar, or the main chat's. The card or page that owns the
 * session renders it.
 */
export const useAddPanelMenu = create<AddPanelMenuState>()((set) => ({
  open: null,
  show: (ptyId, anchor) => {
    const rect = anchor.getBoundingClientRect();
    set({ open: { ptyId, x: rect.left, y: rect.bottom + 4 } });
  },
  close: () => set({ open: null }),
}));
