import { create } from 'zustand';
import type { AnalysisOverview, DiffSignals } from '../analysis/types';
import { describeError } from '../utils/describeError';

const MAX_CACHED = 20;

export function signalsKey(projectPath: string, fingerprint: string): string {
  return projectPath + '\n' + fingerprint;
}

interface AnalysisStoreState {
  /** Insertion-ordered; the oldest entry is evicted past MAX_CACHED. */
  signalsByKey: Map<string, DiffSignals | null>;

  overviewProject: string | null;
  overview: AnalysisOverview | null;
  overviewLoading: boolean;
  overviewError: string | null;
}

interface AnalysisStoreActions {
  load: (projectPath: string, key: string, paths: string[]) => Promise<void>;
  /** For the project poll: rate-limited in the main process, so call blindly. */
  refresh: (projectPath: string) => Promise<void>;
  /** `refresh` rescans first, past the rate limit; otherwise the model answers. */
  loadOverview: (projectPath: string, opts?: { refresh?: boolean }) => Promise<void>;
}

const inflight = new Set<string>();

/** Bumped per load so a stale response can't land over a fresher one. */
let overviewVersion = 0;

export const useAnalysisStore = create<AnalysisStoreState & AnalysisStoreActions>()((set, get) => ({
  signalsByKey: new Map(),
  overviewProject: null,
  overview: null,
  overviewLoading: false,
  overviewError: null,

  refresh: async (projectPath) => {
    await window.api.analysis.refresh(projectPath);
  },

  loadOverview: async (projectPath, opts) => {
    const version = ++overviewVersion;
    const switching = get().overviewProject !== projectPath;
    set({
      overviewLoading: true,
      overviewError: null,
      overviewProject: projectPath,
      ...(switching ? { overview: null } : {}),
    });
    try {
      if (opts?.refresh) await window.api.analysis.refresh(projectPath, true);
      const overview = await window.api.analysis.overview(projectPath);
      if (version !== overviewVersion) return;
      set({ overview, overviewLoading: false });
    } catch (error) {
      if (version !== overviewVersion) return;
      set({ overviewLoading: false, overviewError: describeError(error) });
    }
  },

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
