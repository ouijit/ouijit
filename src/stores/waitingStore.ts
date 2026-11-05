import { create } from 'zustand';
import type { AskRun, HookType } from '../types';

/** A request to run something on the host. It is decided once: run, or declined. */
export interface PendingAsk extends AskRun {
  message?: string;
  run: () => void;
  decline: () => void;
}

/**
 * What an agent left for the user to decide, oldest first: a command it asks
 * to run on the host, or a task move whose hook would have opened a dialog
 * over whatever the user was doing.
 */
export type Waiting = { id: number; from: string; at: number } & (
  | { kind: 'ask'; ask: PendingAsk }
  | { kind: 'move'; projectPath: string; taskNumber: number; hookType: HookType; run: () => void }
);

type Unstamped<W> = W extends Waiting ? Omit<W, 'id' | 'at'> : never;
type NewWaiting = Unstamped<Waiting>;

interface WaitingStore {
  items: Waiting[];
  /** The ask open in its dialog. Closing the dialog leaves it waiting. */
  open: number | null;
  add: (item: NewWaiting) => number;
  /** Take an item off the queue. An ask not yet run is declined. */
  remove: (id: number) => void;
  openAsk: (id: number | null) => void;
}

let nextId = 1;

export const useWaitingStore = create<WaitingStore>()((set, get) => ({
  items: [],
  open: null,
  add: (item) => {
    const id = nextId++;
    set({ items: [...get().items, { ...item, id, at: Date.now() } as Waiting] });
    return id;
  },
  remove: (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;
    if (item.kind === 'ask') item.ask.decline();
    set({ items: get().items.filter((i) => i.id !== id), ...(get().open === id && { open: null }) });
  },
  openAsk: (id) => set({ open: id }),
}));

/** Terminals whose agent is waiting on an answer to an ask. */
export function askingFrom(items: Waiting[]): string[] {
  return items.flatMap((i) => (i.kind === 'ask' ? [i.from] : []));
}
