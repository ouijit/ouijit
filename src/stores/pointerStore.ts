import { create } from 'zustand';
import type { PointTarget } from '../types';

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
  /** Followed once while standing in for its target: the next follow drops it, found or not. */
  followed?: boolean;
}

interface PointerStore {
  pointers: Pointer[];
  point: (pointer: Omit<Pointer, 'at'>) => void;
  dismiss: (from: string) => void;
  markFollowed: (from: string) => void;
}

export const usePointerStore = create<PointerStore>()((set, get) => ({
  pointers: [],
  point: (pointer) =>
    set({ pointers: [...get().pointers.filter((p) => p.from !== pointer.from), { ...pointer, at: Date.now() }] }),
  dismiss: (from) => set({ pointers: get().pointers.filter((p) => p.from !== from) }),
  markFollowed: (from) =>
    set({ pointers: get().pointers.map((p) => (p.from === from ? { ...p, followed: true } : p)) }),
}));

/** The pointer ⌘J follows. */
export function latestPointer(pointers: Pointer[]): Pointer | undefined {
  return pointers.reduce<Pointer | undefined>((latest, p) => (!latest || p.at >= latest.at ? p : latest), undefined);
}
