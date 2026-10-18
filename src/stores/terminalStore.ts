import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_DISPLAY_STATE, type TerminalDisplayState } from './terminalDisplay';

export { DEFAULT_DISPLAY_STATE, isUnread, type TerminalDisplayState, type TerminalStatus } from './terminalDisplay';

/**
 * A stack is the home view's, holding every terminal, or a project's, holding
 * that project's. Both are the one recency order restricted to their members,
 * so the two views always agree on which of two terminals was used last.
 */
export const HOME_STACK = ':home';

export function stackFor(projectPath: string | null): string {
  return projectPath ?? HOME_STACK;
}

interface TerminalStoreState {
  displayStates: Record<string, TerminalDisplayState>;
  /** Each project's terminals, in no particular order. */
  terminalsByProject: Record<string, string[]>;
  /** Every terminal, most recently active first. The front of a stack is its active terminal. */
  order: string[];
  /** Keyed by stack. */
  tagFilters: Record<string, string>;
  /** Null while no stack is on screen. */
  viewedStack: string | null;
  windowFocused: boolean;
}

interface TerminalStoreActions {
  /** Enters at the front of the order, or directly behind its project's front terminal when `background`. */
  addTerminal: (
    projectPath: string,
    ptyId: string,
    initial: Partial<TerminalDisplayState>,
    options?: { background?: boolean },
  ) => void;
  removeTerminal: (ptyId: string) => void;
  updateDisplay: (ptyId: string, patch: Partial<TerminalDisplayState>) => void;
  /**
   * Swap a terminal's key from a placeholder id to the real PTY id. Sandbox
   * terminals register under a per-instance placeholder id before the spawn
   * returns so the loading card can render; once the PTY exists we re-key all
   * per-pty state to the real id, keeping its place in the order.
   */
  rekeyTerminal: (oldPtyId: string, newPtyId: string) => void;
  /** Bring a terminal to the front, clearing any filter that would hide it. False if it is not registered. */
  activate: (ptyId: string) => boolean;
  /** Put these terminals back in this order, in the places they already hold. */
  restoreOrder: (ptyIds: string[]) => void;
  setTagFilter: (stack: string, tag: string | null) => void;
  clearProject: (projectPath: string) => void;
  setViewedStack: (stack: string | null) => void;
  setWindowFocused: (focused: boolean) => void;
}

type TerminalStore = TerminalStoreState & TerminalStoreActions;

function insertBackground(
  order: string[],
  displayStates: Record<string, TerminalDisplayState>,
  projectPath: string,
  ptyId: string,
): string[] {
  const front = order.findIndex((id) => displayStates[id]?.projectPath === projectPath);
  const at = front >= 0 ? front + 1 : Math.min(1, order.length);
  return [...order.slice(0, at), ptyId, ...order.slice(at)];
}

export const useTerminalStore = create<TerminalStore>()((set, get) => ({
  displayStates: {},
  terminalsByProject: {},
  order: [],
  tagFilters: {},
  viewedStack: null,
  windowFocused: true,

  addTerminal: (projectPath, ptyId, initial, options) => {
    const state = get();
    const projectTerminals = state.terminalsByProject[projectPath] ?? [];
    const rest = state.order.filter((id) => id !== ptyId);
    const now = Date.now();
    set({
      displayStates: {
        ...state.displayStates,
        [ptyId]: {
          ...DEFAULT_DISPLAY_STATE,
          ptyId,
          projectPath,
          statusSince: now,
          lastViewedAt: now,
          ...initial,
        },
      },
      terminalsByProject: {
        ...state.terminalsByProject,
        [projectPath]: [...projectTerminals.filter((id) => id !== ptyId), ptyId],
      },
      order: options?.background ? insertBackground(rest, state.displayStates, projectPath, ptyId) : [ptyId, ...rest],
    });
  },

  removeTerminal: (ptyId) => {
    const state = get();
    const display = state.displayStates[ptyId];
    if (!display) return;
    const { [ptyId]: _, ...remainingDisplays } = state.displayStates;
    const projectPath = display.projectPath;
    set({
      displayStates: remainingDisplays,
      terminalsByProject: {
        ...state.terminalsByProject,
        [projectPath]: (state.terminalsByProject[projectPath] ?? []).filter((id) => id !== ptyId),
      },
      order: state.order.filter((id) => id !== ptyId),
    });
  },

  updateDisplay: (ptyId, patch) => {
    const state = get();
    const existing = state.displayStates[ptyId];
    if (!existing) return;
    const next = { ...existing, ...patch };
    if (next.status !== existing.status) next.statusSince = Date.now();
    set({ displayStates: { ...state.displayStates, [ptyId]: next } });
  },

  rekeyTerminal: (oldPtyId, newPtyId) => {
    if (oldPtyId === newPtyId) return;
    const state = get();
    const existing = state.displayStates[oldPtyId];
    if (!existing) return;

    const nextDisplayStates = { ...state.displayStates };
    delete nextDisplayStates[oldPtyId];
    nextDisplayStates[newPtyId] = { ...existing, ptyId: newPtyId };
    const swap = (id: string) => (id === oldPtyId ? newPtyId : id);
    const projectPath = existing.projectPath;

    set({
      displayStates: nextDisplayStates,
      terminalsByProject: {
        ...state.terminalsByProject,
        [projectPath]: (state.terminalsByProject[projectPath] ?? []).map(swap),
      },
      order: state.order.map(swap),
    });
  },

  activate: (ptyId) => {
    const { displayStates, order, tagFilters } = get();
    const display = displayStates[ptyId];
    if (!display) return false;
    const hiding = [HOME_STACK, display.projectPath].filter(
      (stack) => !terminalMatchesTag(display, tagFilters[stack] ?? null),
    );
    if (order[0] === ptyId && hiding.length === 0) return true;
    set({
      order: [ptyId, ...order.filter((id) => id !== ptyId)],
      tagFilters: Object.fromEntries(Object.entries(tagFilters).filter(([stack]) => !hiding.includes(stack))),
    });
    return true;
  },

  restoreOrder: (ptyIds) => {
    const order = get().order;
    const wanted = ptyIds.filter((id, i) => order.includes(id) && ptyIds.indexOf(id) === i);
    const wantedSet = new Set(wanted);
    let next = 0;
    set({ order: order.map((id) => (wantedSet.has(id) ? wanted[next++] : id)) });
  },

  setTagFilter: (stack, tag) => {
    const { [stack]: _, ...rest } = get().tagFilters;
    set({ tagFilters: tag ? { ...rest, [stack]: tag } : rest });
  },

  clearProject: (projectPath) => {
    const state = get();
    const ptyIds = new Set(state.terminalsByProject[projectPath] ?? []);
    const remainingDisplays = { ...state.displayStates };
    for (const id of ptyIds) delete remainingDisplays[id];
    const { [projectPath]: _, ...remainingProjects } = state.terminalsByProject;
    set({
      displayStates: remainingDisplays,
      terminalsByProject: remainingProjects,
      order: state.order.filter((id) => !ptyIds.has(id)),
    });
  },

  setViewedStack: (stack) => {
    if (get().viewedStack !== stack) set({ viewedStack: stack });
  },

  setWindowFocused: (focused) => {
    if (get().windowFocused !== focused) set({ windowFocused: focused });
  },
}));

// ── Viewing ──────────────────────────────────────────────────────────

/** The terminal being read: the front of the stack on screen, in a focused window. Back cards only peek. */
export function viewedPtyId(state: TerminalStoreState): string | undefined {
  if (!state.windowFocused || state.viewedStack === null) return undefined;
  return visibleStack(state, state.viewedStack)[0];
}

// Stamped on leaving rather than arriving, so a terminal that finishes while
// on screen comes out read.
let viewed = viewedPtyId(useTerminalStore.getState());
useTerminalStore.subscribe((state) => {
  const left = viewed;
  viewed = viewedPtyId(state);
  if (left === undefined || left === viewed || !state.displayStates[left]) return;
  state.updateDisplay(left, { lastViewedAt: Date.now() });
});

export function useViewedStack(stack: string): void {
  useEffect(() => {
    useTerminalStore.getState().setViewedStack(stack);
    return () => {
      if (useTerminalStore.getState().viewedStack === stack) useTerminalStore.getState().setViewedStack(null);
    };
  }, [stack]);
}

export function trackWindowFocus(): void {
  const sync = () => useTerminalStore.getState().setWindowFocused(document.hasFocus() && !document.hidden);
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
}

// ── Tag filtering ─────────────────────────────────────────────────────

/** Whether a terminal's display state matches the given tag filter. A null tag matches everything. */
export function terminalMatchesTag(display: TerminalDisplayState | undefined, tag: string | null): boolean {
  if (!tag) return true;
  if (!display) return false;
  const needle = tag.toLowerCase();
  return display.tags.some((t) => t.toLowerCase() === needle);
}

/** Distinct tags (case-insensitive, first-seen casing) present on the given terminals' display states. */
export function collectActiveTags(ptyIds: string[], displayStates: Record<string, TerminalDisplayState>): string[] {
  const seen = new Map<string, string>();
  for (const id of ptyIds) {
    const display = displayStates[id];
    if (!display) continue;
    for (const tag of display.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()];
}

// ── Stacks ───────────────────────────────────────────────────────────

/** A stack's terminals, most recent first. */
export function stackMembers(state: TerminalStoreState, stack: string): string[] {
  if (stack === HOME_STACK) return state.order;
  return state.order.filter((id) => state.displayStates[id]?.projectPath === stack);
}

/** A stack's terminals that its tag filter lets through, most recent first. */
export function visibleStack(state: TerminalStoreState, stack: string): string[] {
  const members = stackMembers(state, stack);
  const tag = state.tagFilters[stack] ?? null;
  return tag ? members.filter((id) => terminalMatchesTag(state.displayStates[id], tag)) : members;
}

export function getActivePtyId(stack: string): string | undefined {
  return visibleStack(useTerminalStore.getState(), stack)[0];
}

export function useVisibleStack(stack: string): string[] {
  return useTerminalStore(useShallow((s) => visibleStack(s, stack)));
}

export function useTagFilter(stack: string): string | null {
  return useTerminalStore((s) => s.tagFilters[stack] ?? null);
}

export function activateTerminal(ptyId: string): boolean {
  return useTerminalStore.getState().activate(ptyId);
}
