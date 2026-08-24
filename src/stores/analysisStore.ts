import { create } from 'zustand';
import type { DiffSignals } from '../analysis/types';

/**
 * Signals cached per (project, file-list fingerprint), so the status polls
 * that hand the diff views fresh arrays every few seconds never refetch.
 */

const MAX_CACHED = 20;

export function signalsKey(projectPath: string, fingerprint: string): string {
  return projectPath + '\n' + fingerprint;
}

interface AnalysisStoreState {
  /** Insertion-ordered; the oldest entry is evicted past MAX_CACHED. */
  signalsByKey: Map<string, DiffSignals | null>;
}

interface AnalysisStoreActions {
  load: (projectPath: string, key: string, paths: string[]) => Promise<void>;
}

const inflight = new Set<string>();

export const useAnalysisStore = create<AnalysisStoreState & AnalysisStoreActions>()((set, get) => ({
  signalsByKey: new Map(),

  load: async (projectPath, key, paths) => {
    if (get().signalsByKey.has(key) || inflight.has(key)) return;
    inflight.add(key);

    let signals: DiffSignals | null = null;
    try {
      signals = await window.api.analysis.diffSignals(projectPath, paths);
    } catch {
      // Cached as null below: a diff renders the same with no signals as with
      // a repo too young to have any.
    }

    set((s) => {
      const next = new Map(s.signalsByKey);
      next.set(key, signals);
      while (next.size > MAX_CACHED) next.delete(next.keys().next().value!);
      return { signalsByKey: next };
    });
    inflight.delete(key);
  },
}));
