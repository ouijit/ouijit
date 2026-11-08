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

export const LIST_TITLES: Record<PanelList, string> = {
  pulls: 'Pull requests',
  issues: 'Issues',
};

interface PanelStoreState {
  /** The project the slot belongs to. Switching projects empties it. */
  projectPath: string | null;
  open: OpenItem;
  listView: PanelList;
  /**
   * Layout of the list beside what it opens. A preference rather than state
   * about a project, so nothing clears it.
   */
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** What a task is being made from, by `creatingKey`. Held here so it outlives the panel being closed. */
  creating: string[];
}

interface PanelStoreActions {
  setProject: (projectPath: string) => void;
  setListView: (list: PanelList) => void;
  setOpen: (item: OpenItem) => void;
  close: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Runs `work` unless a task is already being made from `key`. */
  whileCreating: (key: string, work: () => Promise<void>) => Promise<void>;
}

export const SIDEBAR_DEFAULT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 560;

export const usePanelStore = create<PanelStoreState & PanelStoreActions>()((set, get) => ({
  projectPath: null,
  open: null,
  listView: 'pulls',
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  sidebarCollapsed: false,
  creating: [],

  // Left set, the slot names something in the project you just left: a first
  // Escape closes a phantom, and a same-numbered row here highlights as open.
  setProject: (projectPath) => {
    if (get().projectPath === projectPath) return;
    set({ projectPath, open: null });
  },

  setListView: (listView) => set({ listView }),
  setOpen: (open) => set({ open }),
  close: () => set({ open: null }),

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width))) }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  whileCreating: async (key, work) => {
    if (get().creating.includes(key)) return;
    set({ creating: [...get().creating, key] });
    try {
      await work();
    } finally {
      set({ creating: get().creating.filter((k) => k !== key) });
    }
  },
}));

export function creatingKey(
  projectPath: string,
  source: IssueRow['source'] | 'github-pr',
  key: string | number,
): string {
  return `${projectPath}\0${source}:${key}`;
}

/** Whether the slot holds this row — a row addresses its issue in its own terms. */
export function isRowOpen(open: OpenItem, row: IssueRow): boolean {
  return row.source === 'linear'
    ? open?.source === 'linear' && open.id === row.key
    : open?.source === 'github-issue' && String(open.number) === row.key;
}
