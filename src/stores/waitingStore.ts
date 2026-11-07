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
export type Waiting = { id: number; from: string; at: number } & (
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

type Unstamped<W> = W extends Waiting ? Omit<W, 'id' | 'at'> : never;
type NewWaiting = Unstamped<Waiting>;

interface WaitingStore {
  items: Waiting[];
  /** Whether the dialog that shows them is open. Closing it leaves them waiting. */
  open: boolean;
  /** The item the dialog shows; the first when none is picked or the picked one has gone. */
  selected: number | null;
  add: (item: NewWaiting) => number;
  /** Take an item off the queue. An ask not yet run is declined. */
  remove: (id: number) => void;
  show: (id?: number) => void;
  close: () => void;
}

let nextId = 1;

export const useWaitingStore = create<WaitingStore>()((set, get) => ({
  items: [],
  open: false,
  selected: null,
  add: (item) => {
    const id = nextId++;
    set({ items: [...get().items, { ...item, id, at: Date.now() } as Waiting] });
    return id;
  },
  remove: (id) => {
    const { items, selected } = get();
    const at = items.findIndex((i) => i.id === id);
    if (at === -1) return;
    const item = items[at];
    if (item.kind === 'ask') item.ask.decline();
    const rest = items.filter((i) => i.id !== id);
    // The next one takes the answered one's place, so the dialog moves on rather than back to the start.
    const next = selected === id ? (rest[Math.min(at, rest.length - 1)]?.id ?? null) : selected;
    set({ items: rest, selected: next, ...(rest.length === 0 && { open: false }) });
  },
  show: (id) => {
    if (get().items.length === 0) return;
    set({ open: true, ...(id !== undefined && { selected: id }) });
  },
  close: () => set({ open: false }),
}));

/** Terminals whose agent is waiting on an answer to an ask. */
export function askingFrom(items: Waiting[]): string[] {
  return items.flatMap((i) => (i.kind === 'ask' ? [i.from] : []));
}
