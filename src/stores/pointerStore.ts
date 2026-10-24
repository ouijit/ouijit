import { create } from 'zustand';
import type { AskRun, PointTarget } from '../types';

/** A request to run something on the host, waiting on the user. */
export interface PendingAsk extends AskRun {
  run: () => void;
  decline: () => void;
}

export interface Pointer {
  /** The terminal that pointed. Each has one pointer at most; a new one replaces it. */
  from: string;
  target: PointTarget;
  at: number;
  message?: string;
  /**
   * What following does beyond going there. A CLI task move whose hook would
   * have opened a dialog over the user waits here, and runs on follow.
   */
  then?: () => void;
  /** Following opens it for the user to run or decline; a pointer dropped any other way declines it. */
  ask?: PendingAsk;
}

interface PointerStore {
  pointers: Pointer[];
  /** The terminal whose ask is open for the user to answer. */
  asking: string | null;
  point: (pointer: Omit<Pointer, 'at'>) => void;
  dismiss: (from: string) => void;
  openAsk: (from: string | null) => void;
}

function drop(pointers: Pointer[], from: string): Pointer[] {
  for (const p of pointers) if (p.from === from) p.ask?.decline();
  return pointers.filter((p) => p.from !== from);
}

export const usePointerStore = create<PointerStore>()((set, get) => ({
  pointers: [],
  asking: null,
  point: (pointer) => set({ pointers: [...drop(get().pointers, pointer.from), { ...pointer, at: Date.now() }] }),
  dismiss: (from) => set({ pointers: drop(get().pointers, from), ...(get().asking === from && { asking: null }) }),
  openAsk: (from) => set({ asking: from }),
}));

/** The pointer ⌘J follows. */
export function latestPointer(pointers: Pointer[]): Pointer | undefined {
  return pointers.reduce<Pointer | undefined>((latest, p) => (!latest || p.at >= latest.at ? p : latest), undefined);
}
