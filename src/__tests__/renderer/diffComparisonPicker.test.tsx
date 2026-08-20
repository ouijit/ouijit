import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { DiffComparisonPicker } from '../../components/diff/DiffComparisonPicker';
import { terminalInstances, refreshTerminalGitStatus } from '../../components/terminal/terminalReact';
import type { DiffBaseRef, DiffBases } from '../../types';
import { describeDiffComparison } from '../../diffSource';

// terminalReact pulls xterm in, which hangs under jsdom. The picker only ever
// reaches it for the instance it is changing and the status refresh after.
//
// vi.mock is hoisted above the imports, so the factory can't close over a
// top-level const. Reach the spies through the mocked module instead.
vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map([['pty-1', { setDiffBase: vi.fn() }]]),
  refreshTerminalGitStatus: vi.fn().mockResolvedValue(undefined),
}));

const setDiffBase = vi.mocked(
  (terminalInstances.get('pty-1') as unknown as { setDiffBase: ReturnType<typeof vi.fn> }).setDiffBase,
);

function refs(...names: string[]): DiffBaseRef[] {
  return names.map((ref) => {
    const remote = ref.startsWith('origin/') ? 'origin' : null;
    return { ref, branch: remote ? ref.slice(ref.indexOf('/') + 1) : ref, remote };
  });
}

const BASES: DiffBases = {
  refs: refs('feat/x', 'main', 'origin/main', 'origin/feat/x', 'release', 'origin/release'),
  upstream: 'origin/feat/x',
  defaultRemote: 'origin',
  lastFetch: Date.now() - 4 * 60 * 1000,
};

const PROPS = {
  ptyId: 'pty-1',
  gitPath: '/w',
  base: 'HEAD',
  defaultBase: 'main',
  mainBranch: 'main',
  branch: 'feat/x',
};

function open(props: Partial<Parameters<typeof DiffComparisonPicker>[0]> = {}) {
  render(<DiffComparisonPicker {...PROPS} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: describeDiffComparison(props.base ?? PROPS.base, PROPS.branch) }));
}

const rowNames = () => screen.getAllByRole('menuitem').map((el) => el.textContent?.trim() ?? '');

describe('choosing what the diff compares', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.api.listDiffBases).mockResolvedValue(BASES);
    vi.mocked(window.api.fetchDiffBase).mockResolvedValue({ success: true });
  });

  test('the trigger names the comparison rather than only its kind', () => {
    render(<DiffComparisonPicker {...PROPS} base="origin/main" />);
    expect(screen.getByText('vs origin/main')).toBeTruthy();
  });

  test('leads with the refs that mean something to this branch, in that order', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /^main/ })).toBeTruthy());
    expect(rowNames().slice(0, 4)).toEqual([
      'Uncommitted changesyour last commit',
      'mainbase',
      'origin/mainbase on origin',
      'origin/feat/xpushed',
    ]);
  });

  test('the branch being read is not offered as something to read it against', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /^main/ })).toBeTruthy());
    expect(screen.queryByRole('menuitem', { name: 'feat/x' })).toBeNull();
  });

  test('picking a branch compares against it', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /^main/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('menuitem', { name: /^main/ }));
    expect(setDiffBase).toHaveBeenCalledWith('main');
  });

  test('the uncommitted changes are one of the refs, not a mode beside them', async () => {
    open({ base: 'main' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /^main/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('menuitem', { name: /Uncommitted changes/ }));
    expect(setDiffBase).toHaveBeenCalledWith('HEAD');
  });

  test('picking a remote branch fetches it first — a tracking ref is as old as the last fetch', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /^origin\/main/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('menuitem', { name: /^origin\/main/ }));
    expect(setDiffBase).toHaveBeenCalledWith('origin/main');
    await waitFor(() => expect(window.api.fetchDiffBase).toHaveBeenCalledWith('/w', 'origin/main'));
    // And the file list is re-read against what the fetch brought in.
    await waitFor(() => expect(refreshTerminalGitStatus).toHaveBeenCalled());
  });

  test('says how stale a remote base is without anything being opened', async () => {
    render(<DiffComparisonPicker {...PROPS} base="origin/main" />);
    await waitFor(() => expect(screen.getByText('4m')).toBeTruthy());
    expect(screen.getByLabelText('Fetch origin/main')).toBeTruthy();
  });

  test('a ref nothing has ever fetched says so rather than claiming an age', async () => {
    vi.mocked(window.api.listDiffBases).mockResolvedValue({ ...BASES, lastFetch: null });
    render(<DiffComparisonPicker {...PROPS} base="origin/main" />);
    await waitFor(() => expect(screen.getByText('never')).toBeTruthy());
  });

  test('a fetch that just landed reads as prose, not as a duration of zero', async () => {
    vi.mocked(window.api.listDiffBases).mockResolvedValue({ ...BASES, lastFetch: Date.now() - 2000 });
    render(<DiffComparisonPicker {...PROPS} base="origin/main" />);
    await waitFor(() => expect(screen.getByText('just now')).toBeTruthy());
  });

  test('and fetches it again when that is pressed', async () => {
    render(<DiffComparisonPicker {...PROPS} base="origin/main" />);
    await waitFor(() => expect(screen.getByText('4m')).toBeTruthy());
    fireEvent.click(screen.getByText('4m'));
    await waitFor(() => expect(window.api.fetchDiffBase).toHaveBeenCalledWith('/w', 'origin/main'));
  });

  test('nothing to fetch for a local base', async () => {
    render(<DiffComparisonPicker {...PROPS} base="main" />);
    await waitFor(() => expect(window.api.listDiffBases).toHaveBeenCalled());
    expect(screen.queryByText('4m')).toBeNull();
  });
});

describe('finding a branch in a long list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.api.listDiffBases).mockResolvedValue(BASES);
  });

  test('typing narrows to one flat list, without the groups', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /^main/ })).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Find a branch'), { target: { value: 'release' } });

    expect(rowNames()).toEqual(['release', 'origin/release']);
    expect(screen.queryByText('All branches')).toBeNull();
  });

  test('Enter takes the best match', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /^main/ })).toBeTruthy());
    const field = screen.getByPlaceholderText('Find a branch');
    fireEvent.change(field, { target: { value: 'release' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(setDiffBase).toHaveBeenCalledWith('release');
  });

  test('says so when nothing matches, rather than showing an empty menu', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /^main/ })).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Find a branch'), { target: { value: 'zzzz' } });

    expect(screen.getByText('No branch matches')).toBeTruthy();
  });

  test('the count is stated when the list is cut', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `branch-${String(i).padStart(2, '0')}`);
    vi.mocked(window.api.listDiffBases).mockResolvedValue({ ...BASES, refs: refs('main', 'feat/x', ...many) });
    open();

    await waitFor(() => expect(screen.getByText(/\+5 more/)).toBeTruthy());
  });
});
