/**
 * What "Open in editor" does when it cannot open anything — the case that used
 * to end in silence. Driven through the analysis panel's hotspots; the plan
 * panel's file references go through the same hook.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AnalysisPanel } from '../../components/analysis/AnalysisPanel';
import { ToastContainer } from '../../components/ui/ToastContainer';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useProjectStore } from '../../stores/projectStore';
import type { AnalysisOverview } from '../../analysis/types';

const PROJECT = '/work/alpha';

const overview: AnalysisOverview = {
  commitCount: 40,
  fileCount: 3,
  endMonth: 24_300,
  monthly: new Array<number>(12).fill(3),
  trend: { direction: 'steady', recent: 3, total: 12 },
  hotspots: [
    {
      path: 'src/engine.ts',
      partner: null,
      signal: {
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
      },
    },
  ],
  modules: [],
  moduleCouplings: [],
  couplings: [],
  owners: [],
};

async function clickOpenInEditor() {
  render(
    <>
      <AnalysisPanel projectPath={PROJECT} />
      <ToastContainer />
    </>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /engine\.ts/ }));
  fireEvent.click(screen.getByRole('button', { name: /Open in editor/ }));
}

beforeEach(() => {
  useAnalysisStore.setState({ overview: null, overviewProject: null, overviewLoading: false, overviewError: null });
  useProjectStore.setState({ toasts: [] });
  vi.mocked(window.api.analysis.overview).mockReset().mockResolvedValue(overview);
  vi.mocked(window.api.hooks.save).mockClear();
  vi.mocked(window.api.hooks.get).mockReset().mockResolvedValue({});
});

describe('opening a file in the editor', () => {
  test('offers the setup dialog when no editor is registered, then opens the file it was asked for', async () => {
    vi.mocked(window.api.openFileInEditor).mockReset().mockResolvedValue({ success: false, reason: 'no-editor' });

    await clickOpenInEditor();

    const command = await screen.findByLabelText('Command');
    expect((command as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(command, { target: { value: 'code' } });
    vi.mocked(window.api.openFileInEditor).mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(window.api.openFileInEditor).toHaveBeenCalledTimes(2));
    expect(window.api.openFileInEditor).toHaveBeenLastCalledWith(PROJECT, PROJECT, 'src/engine.ts', undefined);
    expect(useProjectStore.getState().configuredHooks.editor).toBe(true);
  });

  test('names the editor that failed and opens its command for editing', async () => {
    vi.mocked(window.api.openFileInEditor)
      .mockReset()
      .mockResolvedValue({ success: false, reason: 'launch-failed', editor: 'cursor' });
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      editor: { id: 'hook-editor', type: 'editor', name: 'Editor', command: 'cursor' },
    });

    await clickOpenInEditor();

    expect(await screen.findByText('cursor could not open engine.ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change editor' }));

    // The dialog opens on the command that failed, rather than on a blank field.
    const command = await screen.findByLabelText('Command');
    expect((command as HTMLTextAreaElement).value).toBe('cursor');
    fireEvent.change(command, { target: { value: 'code' } });
    vi.mocked(window.api.openFileInEditor).mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(window.api.openFileInEditor).toHaveBeenCalledTimes(2));
  });

  test('says when the file itself is gone', async () => {
    vi.mocked(window.api.openFileInEditor).mockReset().mockResolvedValue({ success: false, reason: 'missing-file' });

    await clickOpenInEditor();

    expect(await screen.findByText('engine.ts no longer exists')).toBeTruthy();
    expect(screen.queryByLabelText('Command')).toBeNull();
  });
});
