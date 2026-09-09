import { create } from 'zustand';
import type { IssueRow } from '../issues/types';

/**
 * What the panel has open. One slot, so two sources cannot both think they are
 * showing something: opening anything replaces whatever was there.
 */
export type OpenItem =
  | { source: 'github-pr'; number: number }
  | { source: 'github-issue'; number: number }
  | { source: 'linear'; id: string }
  | null;

/** Which list the tab bar is on, and what closing an item returns to. */
export type PanelList = 'pulls' | 'issues';

interface PanelStoreState {
  open: OpenItem;
  listView: PanelList;
  /**
   * Layout of the list beside what it opens. A preference rather than state
   * about a project, so nothing clears it.
   */
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

interface PanelStoreActions {
  setListView: (list: PanelList) => void;
  setOpen: (item: OpenItem) => void;
  close: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const SIDEBAR_DEFAULT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 560;

export const usePanelStore = create<PanelStoreState & PanelStoreActions>()((set) => ({
  open: null,
  listView: 'pulls',
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  sidebarCollapsed: false,

  setListView: (listView) => set({ listView }),
  setOpen: (open) => set({ open }),
  close: () => set({ open: null }),

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width))) }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
}));

/** One string naming what is open, so a row can ask whether it is the one. */
export function openKey(item: NonNullable<OpenItem>): string {
  return item.source === 'linear' ? `linear:${item.id}` : `${item.source}:${item.number}`;
}

/** What opening a row of the Issues list puts in the slot. */
export function issueOpenItem(row: IssueRow): NonNullable<OpenItem> {
  return row.source === 'linear'
    ? { source: 'linear', id: row.key }
    : { source: 'github-issue', number: Number(row.key) };
}
