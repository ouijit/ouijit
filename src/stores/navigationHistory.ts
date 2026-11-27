import { create } from 'zustand';
import { useAppStore, type ProjectPage } from './appStore';
import { stackMembers, useTerminalStore } from './terminalStore';
import { LIST_TITLES, usePanelStore, type OpenItem, type PanelList } from './panelStore';
import { useHomeChatStore } from './homeChatStore';

/** Somewhere the user was, as much of it as going back restores. */
export type Place =
  | { kind: 'terminal'; ptyId: string; stack: string }
  | { kind: 'chat'; conversation: string }
  | { kind: 'page'; projectPath: string; page: ProjectPage; list: PanelList; open: OpenItem }
  | { kind: 'app-settings' };

const MAX_PLACES = 50;

/** What is on screen, read off the stores, so a way of getting there that bypasses `navigation.ts` is a place too. */
export function currentPlace(): Place | null {
  const { selection } = useAppStore.getState();
  switch (selection.kind) {
    case 'terminal': {
      const [front] = stackMembers(useTerminalStore.getState(), selection.stack);
      return front ? { kind: 'terminal', ptyId: front, stack: selection.stack } : null;
    }
    case 'chat': {
      const { currentId } = useHomeChatStore.getState();
      return currentId ? { kind: 'chat', conversation: currentId } : null;
    }
    case 'page': {
      const { listView, open } = usePanelStore.getState();
      return { kind: 'page', projectPath: selection.projectPath, page: selection.page, list: listView, open };
    }
    case 'app-settings':
      return { kind: 'app-settings' };
    case 'none':
      return null;
  }
}

export function samePlace(a: Place | null, b: Place | null): boolean {
  if (!a || !b || a.kind !== b.kind) return a === b;
  switch (a.kind) {
    case 'terminal':
      return a.ptyId === (b as typeof a).ptyId;
    case 'chat':
      return a.conversation === (b as typeof a).conversation;
    case 'page': {
      const other = b as typeof a;
      if (a.projectPath !== other.projectPath || a.page !== other.page) return false;
      return a.page !== 'pull-requests' || (a.list === other.list && sameItem(a.open, other.open));
    }
    case 'app-settings':
      return true;
  }
}

function sameItem(a: OpenItem, b: OpenItem): boolean {
  if (!a || !b || a.source !== b.source) return a === b;
  return a.source === 'linear' ? a.id === (b as typeof a).id : a.number === (b as typeof a).number;
}

/** A terminal since closed, a conversation deleted or a project removed is nowhere to go back to. */
export function stillThere(place: Place): boolean {
  switch (place.kind) {
    case 'terminal': {
      const display = useTerminalStore.getState().displayStates[place.ptyId];
      return display != null && !display.isLoading;
    }
    case 'chat': {
      const chat = useHomeChatStore.getState();
      return (
        chat.enabled && (chat.currentId === place.conversation || chat.chats.some((c) => c.id === place.conversation))
      );
    }
    case 'page':
      return useAppStore.getState().projects.some((p) => p.path === place.projectPath);
    case 'app-settings':
      return true;
  }
}

const PAGE_NAMES: Record<ProjectPage, string> = {
  board: 'Board',
  settings: 'Project settings',
  'pull-requests': 'Pull requests',
  analysis: 'Analysis',
};

/** What Back's tooltip calls it: "Back to Chat", "Back to Task 647". */
export function placeName(place: Place): string {
  switch (place.kind) {
    case 'terminal': {
      const display = useTerminalStore.getState().displayStates[place.ptyId];
      if (display?.taskId != null) return `Task ${display.taskId}`;
      return display?.label || 'Terminal';
    }
    case 'chat':
      return 'Chat';
    case 'page': {
      if (place.page === 'pull-requests') {
        const { open } = place;
        if (open?.source === 'linear') return open.id;
        if (open) return `#${open.number}`;
        return LIST_TITLES[place.list];
      }
      const project = useAppStore.getState().projects.find((p) => p.path === place.projectPath);
      const name = PAGE_NAMES[place.page];
      return place.page === 'board' && project ? `${project.name} board` : name;
    }
    case 'app-settings':
      return 'Settings';
  }
}

interface NavigationHistoryState {
  /** Oldest first. Can hold places gone since; `previousPlace` skips them. */
  back: Place[];
}

export const useNavigationHistory = create<NavigationHistoryState>()(() => ({ back: [] }));

/** Where Back goes: the latest place that is still there. */
export function previousPlace(back: Place[] = useNavigationHistory.getState().back): Place | null {
  for (let i = back.length - 1; i >= 0; i--) if (stillThere(back[i])) return back[i];
  return null;
}

/** Takes the latest place still there off the history, with whatever gone since it. */
export function takePreviousPlace(): Place | null {
  const back = [...useNavigationHistory.getState().back];
  while (back.length > 0) {
    const place = back.pop()!;
    if (stillThere(place)) {
      useNavigationHistory.setState({ back });
      return place;
    }
  }
  useNavigationHistory.setState({ back });
  return null;
}

/** Where the user was, as they leave it. Gone places, and the same place twice running, are not kept. */
export function rememberPlace(place: Place | null): void {
  if (!place || !stillThere(place)) return;
  const { back } = useNavigationHistory.getState();
  if (samePlace(back.at(-1) ?? null, place)) return;
  useNavigationHistory.setState({ back: [...back, place].slice(-MAX_PLACES) });
}

let settled: Place | null = null;
let depth = 0;
let pending = false;
let armed = false;
let installed = false;

function settle(record: boolean): void {
  const now = currentPlace();
  if (!samePlace(settled, now) && record && armed) rememberPlace(settled);
  settled = now;
}

function changed(): void {
  if (pending || depth > 0) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    if (depth === 0) settle(true);
  });
}

/**
 * Records each move off a place by watching what is on screen. The stores
 * change a step at a time (opening a pull request sets the page, the project
 * and the item in turn), so the changes of one task are one move. Recording
 * starts with the user's first click or key, so restoring the last session at
 * launch is not history. Once per window.
 */
export function installNavigationHistory(): void {
  if (installed) return;
  installed = true;
  settled = currentPlace();
  useAppStore.subscribe(changed);
  useTerminalStore.subscribe(changed);
  usePanelStore.subscribe(changed);
  useHomeChatStore.subscribe(changed);
  const arm = () => (armed = true);
  window.addEventListener('pointerdown', arm, { capture: true, once: true });
  window.addEventListener('keydown', arm, { capture: true, once: true });
}

/**
 * `work` as one move however long it takes, from where it started to where it
 * ends. With `record` false it is not remembered at all: going back.
 */
export async function asOneMove<T>(work: () => Promise<T>, record = true): Promise<T> {
  if (depth === 0) settle(true);
  depth++;
  try {
    return await work();
  } finally {
    depth--;
    if (depth === 0) settle(record);
  }
}
