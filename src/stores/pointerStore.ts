import { create } from 'zustand';
import type { PointTarget } from '../types';

export interface Pointer {
  /** The terminal that pointed. Each has one pointer at most; a new one replaces it. */
  from: string;
  target: PointTarget;
  at: number;
  /**
   * What following does beyond going there. A CLI task move whose hook would
   * have opened a dialog over the user waits here, and runs on follow.
   */
  then?: () => void;
}

interface PointerStore {
  pointers: Pointer[];
  point: (pointer: Omit<Pointer, 'at'>) => void;
  dismiss: (from: string) => void;
}

export const usePointerStore = create<PointerStore>()((set, get) => ({
  pointers: [],
  point: (pointer) =>
    set({ pointers: [...get().pointers.filter((p) => p.from !== pointer.from), { ...pointer, at: Date.now() }] }),
  dismiss: (from) => set({ pointers: get().pointers.filter((p) => p.from !== from) }),
}));

/** The pointer ⌘J follows. */
export function latestPointer(pointers: Pointer[]): Pointer | undefined {
  return pointers.reduce<Pointer | undefined>((latest, p) => (!latest || p.at >= latest.at ? p : latest), undefined);
}
