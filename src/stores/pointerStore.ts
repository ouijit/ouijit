import { create } from 'zustand';
import type { AskRun, PointTarget } from '../types';

/** A request to run something on the host, waiting on the user. */
export interface PendingAsk extends AskRun {
  run: () => void;
  decline: () => void;
}

/** A CLI task move whose hook would have opened a dialog over the user, waiting to run. */
export interface WaitingMove {
  target: PointTarget;
  run: () => void;
}

export interface Pointer {
  /** The terminal that pointed. Each has one pointer at most; a new one replaces it. */
  from: string;
  target: PointTarget;
  at: number;
  message?: string;
  /**
   * Every move this terminal's commands have left waiting, oldest first. They
   * are the user's: pointing elsewhere or `point clear` keeps them, so a loop
   * of starts loses none, and only following or dismissing ends them.
   */
  waiting?: WaitingMove[];
  /** The latest point was a move, so following runs the moves and goes nowhere else. */
  moved?: boolean;
  /** Following opens it for the user to run or decline; replacing it any other way declines it. */
  ask?: PendingAsk;
}

interface PointerStore {
  pointers: Pointer[];
  /** The terminal whose ask is open for the user to answer. */
  asking: string | null;
  point: (pointer: Omit<Pointer, 'at' | 'waiting' | 'moved'> & { move?: () => void }) => void;
  /** The user is done with this terminal's pointer, waiting moves and all. */
  dismiss: (from: string) => void;
  /** The agent's point or ask is over; any moves still waiting stay as the pointer. */
  clear: (from: string) => void;
  openAsk: (from: string | null) => void;
}

/** What is left of a pointer once its point or ask is gone: its waiting moves, pointing at the newest. */
function movesOnly(from: string, waiting: WaitingMove[]): Pointer[] {
  const newest = waiting.at(-1);
  return newest ? [{ from, target: newest.target, at: Date.now(), waiting, moved: true }] : [];
}

export const usePointerStore = create<PointerStore>()((set, get) => ({
  pointers: [],
  asking: null,
  point: ({ move, ...pointer }) => {
    const previous = get().pointers.find((p) => p.from === pointer.from);
    if (previous?.ask && previous.ask !== pointer.ask) previous.ask.decline();
    const waiting = [...(previous?.waiting ?? []), ...(move ? [{ target: pointer.target, run: move }] : [])];
    set({
      pointers: [
        ...get().pointers.filter((p) => p.from !== pointer.from),
        { ...pointer, at: Date.now(), ...(waiting.length > 0 && { waiting }), ...(move && { moved: true }) },
      ],
    });
  },
  dismiss: (from) => {
    for (const p of get().pointers) if (p.from === from) p.ask?.decline();
    set({ pointers: get().pointers.filter((p) => p.from !== from), ...(get().asking === from && { asking: null }) });
  },
  clear: (from) => {
    const previous = get().pointers.find((p) => p.from === from);
    if (!previous) return;
    previous.ask?.decline();
    set({
      pointers: [...get().pointers.filter((p) => p.from !== from), ...movesOnly(from, previous.waiting ?? [])],
      ...(get().asking === from && { asking: null }),
    });
  },
  openAsk: (from) => set({ asking: from }),
}));

/** The pointer ⌘J follows. */
export function latestPointer(pointers: Pointer[]): Pointer | undefined {
  return pointers.reduce<Pointer | undefined>((latest, p) => (!latest || p.at >= latest.at ? p : latest), undefined);
}
