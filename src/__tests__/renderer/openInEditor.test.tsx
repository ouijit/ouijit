/**
 * What "Open in editor" does when it cannot open anything. Driven through the
 * analysis panel's hotspots; the plan panel's file references and the task
 * menus reach the same service.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AnalysisPanel } from '../../components/analysis/AnalysisPanel';
import { ToastContainer } from '../../components/ui/ToastContainer';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore, type EditorHookRequest } from '../../stores/uiStore';
import { openTaskInEditor } from '../../services/openInEditor';
import { openWorktreeEditor } from '../../components/terminal/terminalActions';
import type { AnalysisOverview, ScriptHook, TaskWithWorkspace } from '../../types';

vi.mock('../../components/terminal/terminalActions', () => ({ openWorktreeEditor: vi.fn() }));

const PROJECT = '/work/alpha';
const EDITOR: ScriptHook = { id: 'hook-editor', type: 'editor', name: 'Editor', command: 'code' };
const NEVER_STARTED = { taskNumber: 7, name: 'Fresh', status: 'todo', createdAt: '2026-08-01' } as TaskWithWorkspace;

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

/** Answer the editor-hook prompt the moment it is raised, as the dialog would. */
function answerEditorPrompt(hook: ScriptHook | null): Promise<EditorHookRequest> {
  return new Promise((settled) => {
    const answer = (pending: EditorHookRequest | undefined): boolean => {
      if (!pending) return false;
      useUIStore.getState().resolveEditorHook(pending.id, hook);
      settled(pending);
      return true;
    };
    if (answer(useUIStore.getState().editorHookQueue[0])) return;
    const stop = useUIStore.subscribe((state) => {
      if (answer(state.editorHookQueue[0])) stop();
    });
  });
}

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
  useUIStore.setState({ editorHookQueue: [] });
  vi.mocked(window.api.analysis.overview).mockReset().mockResolvedValue(overview);
  vi.mocked(window.api.hooks.get).mockReset().mockResolvedValue({});
  vi.mocked(openWorktreeEditor).mockReset();
  window.api.task.start = vi.fn().mockResolvedValue({ success: true, worktreePath: '/work/alpha-7' });
});

describe('opening a file in the editor', () => {
  test('asks for an editor when none is registered, then opens the file it was asked for', async () => {
    vi.mocked(window.api.openFileInEditor).mockReset().mockResolvedValue({ success: false, reason: 'no-editor' });

    await clickOpenInEditor();
    const request = await answerEditorPrompt(EDITOR);

    expect(request.existingHook).toBeUndefined();
    await waitFor(() => expect(window.api.openFileInEditor).toHaveBeenCalledTimes(2));
    expect(window.api.openFileInEditor).toHaveBeenLastCalledWith(PROJECT, PROJECT, 'src/engine.ts', undefined);
  });

  test('names the editor that failed and offers its command for correcting', async () => {
    vi.mocked(window.api.openFileInEditor)
      .mockReset()
      .mockResolvedValue({ success: false, reason: 'launch-failed', editor: 'cursor' });
    vi.mocked(window.api.hooks.get).mockResolvedValue({ editor: { ...EDITOR, command: 'cursor' } });

    await clickOpenInEditor();

    expect(await screen.findByText('cursor could not open engine.ts')).toBeTruthy();
    expect(useUIStore.getState().editorHookQueue).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Change editor' }));
    const request = await answerEditorPrompt(EDITOR);

    expect(request.existingHook?.command).toBe('cursor');
    await waitFor(() => expect(window.api.openFileInEditor).toHaveBeenCalledTimes(2));
  });

  test('backing out of the request opens nothing', async () => {
    vi.mocked(window.api.openFileInEditor).mockReset().mockResolvedValue({ success: false, reason: 'no-editor' });

    await clickOpenInEditor();
    await answerEditorPrompt(null);

    await waitFor(() => expect(useUIStore.getState().editorHookQueue).toHaveLength(0));
    expect(window.api.openFileInEditor).toHaveBeenCalledTimes(1);
  });

  test('says when the file itself is gone', async () => {
    vi.mocked(window.api.openFileInEditor).mockReset().mockResolvedValue({ success: false, reason: 'missing-file' });

    await clickOpenInEditor();

    expect(await screen.findByText('engine.ts no longer exists')).toBeTruthy();
    expect(useUIStore.getState().editorHookQueue).toHaveLength(0);
  });
});

describe('opening a task in the editor', () => {
  test('creates the worktree only once there is an editor to open it with', async () => {
    const backedOut = openTaskInEditor(PROJECT, NEVER_STARTED);
    await answerEditorPrompt(null);
    await backedOut;

    expect(window.api.task.start).not.toHaveBeenCalled();
    expect(openWorktreeEditor).not.toHaveBeenCalled();

    const opened = openTaskInEditor(PROJECT, NEVER_STARTED);
    await answerEditorPrompt(EDITOR);
    await opened;

    expect(window.api.task.start).toHaveBeenCalledWith(PROJECT, 7);
    expect(openWorktreeEditor).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ path: '/work/alpha-7' }),
      7,
      'code',
    );
  });
});
