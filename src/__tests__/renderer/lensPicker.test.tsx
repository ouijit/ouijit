import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { LensPicker } from '../../components/diff/LensPicker';
import type { StoredLens } from '../../lens/readLens';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

/** A lens as it comes back from main: named, with as many groups as it claims. */
function onFile(lensName: string | null, groups: number | null, stale: boolean): StoredLens {
  return {
    lensName,
    groups: groups === null ? null : Array.from({ length: groups }, (_, i) => ({ title: `Part ${i}`, slices: [] })),
    stale,
  };
}

const LENSES = [{ name: 'Narrative', instruction: 'group by story' }];

function open(lens: StoredLens | null, over: { lensOn?: boolean; writing?: string | null } = {}) {
  const onRun = vi.fn();
  const onShowLens = vi.fn();
  render(
    <LensPicker
      lenses={LENSES}
      onFile={lens}
      lensOn={over.lensOn ?? true}
      changedFiles={4}
      viewed={0}
      writing={over.writing ?? null}
      onAllFiles={vi.fn()}
      onShowLens={onShowLens}
      onRun={onRun}
      onManage={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { expanded: false }));
  return { onRun, onShowLens, row: () => screen.getByRole('menuitem', { name: /^Narrative/ }) };
}

describe('picking how to read a diff', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('a lens that still fits is a view to switch to, not a run to repeat', () => {
    const { onRun, onShowLens, row } = open(onFile('Narrative', 3, false), { lensOn: false });

    expect(row().textContent).toContain('3 parts');
    fireEvent.click(row());
    expect(onShowLens).toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });

  /**
   * A lens on screen *and* out of date is the worktree diff's ordinary
   * condition, since that diff moves on every save. If being applied wins the
   * branch, the one lens a reader can see has drifted is the one they cannot
   * re-run.
   */
  test('a lens that is on screen and out of date offers to be written again', () => {
    const { onRun, onShowLens, row } = open(onFile('Narrative', 3, true));

    expect(row().textContent).toContain('3 parts');
    expect(row().textContent).toContain('out of date');

    fireEvent.click(row());
    expect(onRun).toHaveBeenCalledWith(LENSES[0]);
    expect(onShowLens).not.toHaveBeenCalled();
  });

  test('a lens dropped for being out of date is named and offered again', () => {
    // What a pull request does with one: after a force-push the hunks it points
    // at are gone, so nothing is rendered and only the name survives.
    const { onRun, row } = open(onFile('Narrative', null, true));

    expect(row().textContent).toContain('out of date');
    expect(row().textContent).not.toContain('parts');

    fireEvent.click(row());
    expect(onRun).toHaveBeenCalledWith(LENSES[0]);
  });

  test('one run at a time — a stale lens cannot be started while another is writing', () => {
    const { row } = open(onFile('Narrative', 3, true), { writing: 'Other' });
    expect(row().hasAttribute('disabled')).toBe(true);
  });

  test('a lens the project no longer has is named but not offered to run', () => {
    // Renamed, deleted, or posted over the CLI: there is no row in the list to
    // start it from, so the picker gives it one that only goes back to it.
    const { onRun, onShowLens } = open(onFile('Gone', 2, true));

    const orphan = screen.getByRole('menuitem', { name: /^Gone/ });
    expect(orphan.textContent).toContain('out of date');
    fireEvent.click(orphan);
    expect(onShowLens).toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });
});
