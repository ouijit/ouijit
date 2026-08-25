/**
 * The analysis surfaces with the flag actually on.
 *
 * Every other renderer test runs with it off, where the hook returns early and
 * nothing downstream executes — so without this the whole rendering path ships
 * unexercised: what the risk section says about a pull request, and which files
 * are worth a chip at all.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { RiskSection } from '../../components/github/RiskSection';
import { worthAChip } from '../../components/diff/AnalysisChip';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useExperimentalStore } from '../../stores/experimentalStore';
import { useGithubStore } from '../../stores/githubStore';
import { DEFAULT_EXPERIMENTAL_FLAGS } from '../../experimentalFlags';
import type { DiffSignals, FileSignal, PullRequestDetail } from '../../analysis/types';

const PROJECT = '/work/alpha';

function signal(over: Partial<FileSignal> = {}): FileSignal {
  return {
    commits: 40,
    added: 400,
    deleted: 200,
    score: 0.95,
    tier: 'hot',
    freqRank: 0.98,
    cxRank: 0.95,
    monthly: new Array<number>(12).fill(3),
    trend: { direction: 'rising', recent: 20, total: 40 },
    topAuthors: [{ name: 'Alice', share: 0.8 }],
    authorCount: 2,
    complexity: { loc: 800, indentTotal: 1600, indentMax: 7 },
    ...over,
  };
}

const detail = { headSha: 'abc123' } as PullRequestDetail;
const files = [
  { path: 'src/engine.ts', status: 'modified', additions: 10, deletions: 2 },
  { path: 'src/calm.ts', status: 'modified', additions: 1, deletions: 1 },
];

beforeEach(() => {
  useAnalysisStore.setState({ signalsByKey: new Map() });
  useExperimentalStore.setState({ flagsByProject: { [PROJECT]: { ...DEFAULT_EXPERIMENTAL_FLAGS, analysis: true } } });
  useGithubStore.setState({ projectPath: PROJECT, files: files as never });
  vi.mocked(window.api.analysis.diffSignals).mockReset().mockResolvedValue(null);
});

describe('what a pull request’s history says about it', () => {
  test('names the hotspots it touches and the files it leaves behind', async () => {
    const signals: DiffSignals = {
      'src/engine.ts': { signal: signal(), missing: ['src/absent.ts'] },
      'src/calm.ts': { signal: signal({ tier: 'quiet', commits: 2 }), missing: [] },
    };
    vi.mocked(window.api.analysis.diffSignals).mockResolvedValue(signals);

    render(<RiskSection detail={detail} />);

    // Two rows for the one file: it runs hot, and it usually brings another.
    const section = await screen.findByRole('button', { name: /Risk\s*2/ });
    fireEvent.click(section);

    expect(screen.getByText(/40 commits in 12 months · most edits by Alice/)).toBeTruthy();
    expect(screen.getByText(/Usually changes with src\/absent.ts — not in this pull request/)).toBeTruthy();
    // The quiet file has nothing to answer for, so it is not listed at all.
    expect(screen.queryByText('src/calm.ts')).toBeNull();
  });

  test('says nothing at all when the history is unremarkable', async () => {
    vi.mocked(window.api.analysis.diffSignals).mockResolvedValue({
      'src/calm.ts': { signal: signal({ tier: 'quiet' }), missing: [] },
    });

    const { container } = render(<RiskSection detail={detail} />);
    await vi.waitFor(() => expect(window.api.analysis.diffSignals).toHaveBeenCalled());
    expect(container.querySelector('*')).toBeNull();
  });

  test('renders nothing while the flag is off, without asking the main process', async () => {
    useExperimentalStore.setState({ flagsByProject: { [PROJECT]: DEFAULT_EXPERIMENTAL_FLAGS } });

    const { container } = render(<RiskSection detail={detail} />);
    expect(container.querySelector('*')).toBeNull();
    expect(window.api.analysis.diffSignals).not.toHaveBeenCalled();
  });
});

describe('which files are worth a chip', () => {
  test('a hotspot or an absent companion, and nothing else', () => {
    expect(worthAChip({ signal: signal(), missing: [] })).toBe(true);
    expect(worthAChip({ signal: signal({ tier: 'warm' }), missing: [] })).toBe(true);
    expect(worthAChip({ signal: signal({ tier: 'quiet' }), missing: ['src/other.ts'] })).toBe(true);
    expect(worthAChip({ signal: signal({ tier: 'quiet' }), missing: [] })).toBe(false);
  });
});
