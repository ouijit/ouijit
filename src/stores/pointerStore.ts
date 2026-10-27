import { create } from 'zustand';
import type { AskRun, PointTarget } from '../types';

/** A request to run something on the host, waiting on the user. */
export interface PendingAsk extends AskRun {
  /** Why the agent asks; kept on the ask, since one can wait behind another. */
  message?: string;
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
  /** Asks sent while `ask` waited, oldest first: each comes up once the one before is answered. */
  laterAsks?: PendingAsk[];
}

interface PointerStore {
  pointers: Pointer[];
  /** The terminal whose ask is open for the user to answer. */
  asking: string | null;
  point: (pointer: Omit<Pointer, 'at' | 'waiting' | 'moved'> & { move?: () => void }) => void;
  /** The user is done with this terminal's pointer, waiting moves and all. */
  dismiss: (from: string) => void;
  /** The agent withdraws its point and its asks; any moves still waiting stay as the pointer. */
  clear: (from: string) => void;
  /** The user ran or declined the ask in front; the next one behind it, if any, takes its place. */
  answered: (from: string) => void;
  openAsk: (from: string | null) => void;
}

function declineAsks(pointer: Pointer | undefined): void {
  pointer?.ask?.decline();
  for (const ask of pointer?.laterAsks ?? []) ask.decline();
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
    if (previous?.ask && pointer.ask) {
      const queued = { ...previous, at: Date.now(), laterAsks: [...(previous.laterAsks ?? []), pointer.ask] };
      set({ pointers: [...get().pointers.filter((p) => p.from !== pointer.from), queued] });
      return;
    }
    declineAsks(previous);
    const waiting = [...(previous?.waiting ?? []), ...(move ? [{ target: pointer.target, run: move }] : [])];
    set({
      pointers: [
        ...get().pointers.filter((p) => p.from !== pointer.from),
        { ...pointer, at: Date.now(), ...(waiting.length > 0 && { waiting }), ...(move && { moved: true }) },
      ],
    });
  },
  dismiss: (from) => {
    declineAsks(get().pointers.find((p) => p.from === from));
    set({ pointers: get().pointers.filter((p) => p.from !== from), ...(get().asking === from && { asking: null }) });
  },
  clear: (from) => {
    const previous = get().pointers.find((p) => p.from === from);
    if (!previous) return;
    declineAsks(previous);
    set({
      pointers: [...get().pointers.filter((p) => p.from !== from), ...movesOnly(from, previous.waiting ?? [])],
      ...(get().asking === from && { asking: null }),
    });
  },
  answered: (from) => {
    const previous = get().pointers.find((p) => p.from === from);
    if (!previous) return;
    // Declined, unless it was run: an ask decides once.
    previous.ask?.decline();
    const [next, ...later] = previous.laterAsks ?? [];
    if (!next) {
      get().clear(from);
      return;
    }
    const { message: _answered, ...rest } = previous;
    set({
      pointers: [
        ...get().pointers.filter((p) => p.from !== from),
        {
          ...rest,
          at: Date.now(),
          ask: next,
          ...(next.message && { message: next.message }),
          laterAsks: later.length > 0 ? later : undefined,
        },
      ],
    });
  },
  openAsk: (from) => set({ asking: from }),
}));

/** The pointer ⌘J follows. */
export function latestPointer(pointers: Pointer[]): Pointer | undefined {
  return pointers.reduce<Pointer | undefined>((latest, p) => (!latest || p.at >= latest.at ? p : latest), undefined);
}
