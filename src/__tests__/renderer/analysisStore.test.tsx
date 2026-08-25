/**
 * The analysis store's cache, which is what keeps the diff and pull request
 * surfaces on one fetch while a status poll hands them a fresh file array
 * every few seconds.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useAnalysisStore, signalsKey } from '../../stores/analysisStore';
import type { AnalysisOverview, DiffSignals, FileSignal } from '../../analysis/types';

function signal(over: Partial<FileSignal> = {}): FileSignal {
  return {
    commits: 9,
    added: 90,
    deleted: 10,
    score: 0.9,
    tier: 'hot',
    freqRank: 0.97,
    cxRank: 0.93,
    monthly: new Array<number>(12).fill(1),
    trend: { direction: 'rising', recent: 6, total: 9 },
    topAuthors: [{ name: 'Alice', share: 0.8 }],
    authorCount: 2,
    complexity: { loc: 400, indentTotal: 800, indentMax: 5 },
    ...over,
  };
}

const signals: DiffSignals = { 'a.ts': { signal: signal(), missing: ['b.ts'] } };

function overview(commitCount: number): AnalysisOverview {
  return {
    commitCount,
    fileCount: 3,
    endMonth: 24_300,
    monthly: new Array<number>(12).fill(1),
    trend: { direction: 'steady', recent: 3, total: 12 },
    hotspots: [],
    modules: [],
    moduleCouplings: [],
    couplings: [],
    owners: [],
  };
}

beforeEach(() => {
  useAnalysisStore.setState({
    signalsByKey: new Map(),
    overviewProject: null,
    overview: null,
    overviewLoading: false,
    overviewError: null,
  });
  vi.mocked(window.api.analysis.diffSignals).mockReset().mockResolvedValue(signals);
  vi.mocked(window.api.analysis.overview).mockReset().mockResolvedValue(overview(1));
  vi.mocked(window.api.analysis.refresh).mockReset().mockResolvedValue(undefined);
});

describe('signals for a file list', () => {
  test('one fetch answers every surface asking under the same key, until it is evicted', async () => {
    const store = () => useAnalysisStore.getState();
    const key = signalsKey('/p', 'fingerprint');

    await Promise.all([
      store().load('/p', key, ['a.ts']),
      store().load('/p', key, ['a.ts']),
      store().load('/p', key, ['a.ts']),
    ]);
    expect(window.api.analysis.diffSignals).toHaveBeenCalledTimes(1);
    expect(store().signalsByKey.get(key)).toEqual(signals);

    // A later ask under the same key is answered from the cache, not refetched.
    await store().load('/p', key, ['a.ts']);
    expect(window.api.analysis.diffSignals).toHaveBeenCalledTimes(1);

    // Twenty other file lists push it out; the surface still on screen watches
    // for exactly this and asks again, which has to reach the main process.
    for (let i = 0; i < 20; i++) await store().load('/p', signalsKey('/p', `other-${i}`), ['x.ts']);
    expect(store().signalsByKey.has(key)).toBe(false);

    await store().load('/p', key, ['a.ts']);
    expect(store().signalsByKey.get(key)).toEqual(signals);
  });

  test('a diff whose signals fail to load renders like one with no history', async () => {
    vi.mocked(window.api.analysis.diffSignals).mockRejectedValueOnce(new Error('no repo'));
    const key = signalsKey('/p', 'fingerprint');

    await useAnalysisStore.getState().load('/p', key, ['a.ts']);
    expect(useAnalysisStore.getState().signalsByKey.get(key)).toBeNull();
  });
});

describe('the project overview', () => {
  test('the most-recent load wins regardless of IPC resolve order', async () => {
    let resolveFirst!: (v: AnalysisOverview) => void;
    vi.mocked(window.api.analysis.overview)
      .mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
      .mockResolvedValueOnce(overview(2));

    const first = useAnalysisStore.getState().loadOverview('/p');
    const second = useAnalysisStore.getState().loadOverview('/p');
    await second;
    resolveFirst(overview(1));
    await first;

    expect(useAnalysisStore.getState().overview?.commitCount).toBe(2);
    expect(useAnalysisStore.getState().overviewLoading).toBe(false);
  });

  test('switching project clears the old overview, and refreshing keeps it on screen', async () => {
    await useAnalysisStore.getState().loadOverview('/p');
    expect(useAnalysisStore.getState().overview).not.toBeNull();

    let resolveSwitch!: (v: AnalysisOverview) => void;
    vi.mocked(window.api.analysis.overview).mockImplementationOnce(() => new Promise((res) => (resolveSwitch = res)));
    const switching = useAnalysisStore.getState().loadOverview('/other');
    expect(useAnalysisStore.getState().overview).toBeNull();
    resolveSwitch(overview(5));
    await switching;

    // Same project: the numbers stay put rather than blanking under the spinner.
    let resolveRefresh!: (v: AnalysisOverview) => void;
    vi.mocked(window.api.analysis.overview).mockImplementationOnce(() => new Promise((res) => (resolveRefresh = res)));
    const refreshing = useAnalysisStore.getState().loadOverview('/other', { refresh: true });
    await vi.waitFor(() => expect(window.api.analysis.overview).toHaveBeenCalledTimes(3));
    expect(useAnalysisStore.getState().overview?.commitCount).toBe(5);
    // Asking outright goes past the poll's rate limit.
    expect(window.api.analysis.refresh).toHaveBeenCalledWith('/other', true);
    resolveRefresh(overview(6));
    await refreshing;
    expect(useAnalysisStore.getState().overview?.commitCount).toBe(6);
  });

  test('a failed load leaves the panel something to say', async () => {
    vi.mocked(window.api.analysis.overview).mockRejectedValueOnce(new Error('git exploded'));
    await useAnalysisStore.getState().loadOverview('/p');

    const state = useAnalysisStore.getState();
    expect(state.overviewLoading).toBe(false);
    expect(state.overviewError).toContain('git exploded');
  });
});
