import { create } from 'zustand';
import type { AskRun, HookType } from '../types';

/** A request to run something on the host. It is decided once: run, or declined. */
export interface PendingAsk extends AskRun {
  message?: string;
  /** Privately, the agent is told how it ended but not what it printed. */
  run: (privately?: boolean) => void;
  decline: () => void;
}

/**
 * What an agent left for the user to decide: a command it asks to run on the
 * host, or a task move whose hook would have opened a dialog over whatever the
 * user was doing.
 */
export type Waiting = { id: number; from: string; at: number; toastHidden?: boolean } & (
  | { kind: 'ask'; ask: PendingAsk }
  | {
      kind: 'move';
      projectPath: string;
      taskNumber: number;
      hookType: HookType;
      /** The hook's name and command, as it will run. */
      hookName: string;
      command: string;
      /** The hook runs on the host though the agent that moved the task is sandboxed. */
      outsideSandbox: boolean;
      run: () => void;
    }
);

type Unstamped<W> = W extends Waiting ? Omit<W, 'id' | 'at' | 'toastHidden'> : never;
type NewWaiting = Unstamped<Waiting>;

interface WaitingStore {
  items: Waiting[];
  /** Terminals with a card on screen, by how many: what they leave shows there rather than as a toast. */
  shownOn: Record<string, number>;
  add: (item: NewWaiting) => number;
  /** Take an item off the queue. An ask not yet run is declined. */
  remove: (id: number) => void;
  hideToast: (id: number) => void;
  cardMounted: (ptyId: string) => () => void;
}

let nextId = 1;

export const useWaitingStore = create<WaitingStore>()((set, get) => ({
  items: [],
  shownOn: {},
  add: (item) => {
    const id = nextId++;
    set({ items: [...get().items, { ...item, id, at: Date.now() } as Waiting] });
    return id;
  },
  remove: (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;
    if (item.kind === 'ask') item.ask.decline();
    set({ items: get().items.filter((i) => i.id !== id) });
  },
  hideToast: (id) => set({ items: get().items.map((i) => (i.id === id ? { ...i, toastHidden: true } : i)) }),
  cardMounted: (ptyId) => {
    const count = (delta: number) => {
      const { [ptyId]: was = 0, ...rest } = get().shownOn;
      set({ shownOn: was + delta > 0 ? { ...rest, [ptyId]: was + delta } : rest });
    };
    count(1);
    return () => count(-1);
  },
}));

export function toasted(items: Waiting[], shownOn: Record<string, number>): Waiting[] {
  return items.filter((i) => !i.toastHidden && !(i.from in shownOn));
}

/** Terminals whose agent is waiting on an answer to an ask. */
export function askingFrom(items: Waiting[]): string[] {
  return items.flatMap((i) => (i.kind === 'ask' ? [i.from] : []));
}
