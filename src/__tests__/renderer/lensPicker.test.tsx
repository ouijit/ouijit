import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { LensPicker } from '../../components/diff/LensPicker';
import type { StoredLens } from '../../lens/readLens';
import type { LensRun } from '../../components/diff/useLensSession';
import type { ResolvedGroup } from '../../lens/lens';
import { NARRATIVE } from '../lensFixtures';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

/** A lens as it comes back from main: whose it is, and how many groups it claims. */
function onFile(lens: { id: string; name: string } | null, groups: number | null, stale: boolean): StoredLens {
  return {
    lensId: lens?.id ?? null,
    lensName: lens?.name ?? null,
    groups: groups === null ? null : Array.from({ length: groups }, (_, i) => ({ title: `Part ${i}`, slices: [] })),
    stale,
    omitted: 0,
    running: null,
  };
}

const LENSES = [NARRATIVE];

function open(
  lens: StoredLens | null,
  over: { lensOn?: boolean; writing?: LensRun | null; resolved?: ResolvedGroup[]; promptChars?: number } = {},
) {
  const onRun = vi.fn();
  const onShowLens = vi.fn();
  render(
    <LensPicker
      lenses={LENSES}
      onFile={lens}
      resolved={over.resolved ?? null}
      lensOn={over.lensOn ?? true}
      changedFiles={4}
      promptChars={over.promptChars ?? 4_000}
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
    const { onRun, onShowLens, row } = open(onFile(NARRATIVE, 3, false), { lensOn: false });

    expect(row().textContent).toContain('3 parts');
    fireEvent.click(row());
    expect(onShowLens).toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });

  /**
   * Deleting a lens and writing it again mints a new id, and the grouping on
   * file still names the old one. Two rows with one name in them — one saying
   * it had been written, one offering to write it — is a choice nobody can
   * make.
   */
  test('a lens written again under the same name is one row, not two', () => {
    const { onRun, onShowLens } = open(onFile({ id: 'gone', name: 'Narrative' }, 3, false));

    const rows = screen.getAllByRole('menuitem', { name: /^Narrative/ });
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('3 parts');

    // And it is the row it looks like: the lens on screen, not a run to start.
    fireEvent.click(rows[0]);
    expect(onShowLens).toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });

  /**
   * A lens on screen *and* out of date is the worktree diff's ordinary
   * condition, since that diff moves on every save. If being applied wins the
   * branch, the one lens a reader can see has drifted is the one they cannot
   * re-run.
   */
  test('an out-of-date lens offers to be written again, drawn or dropped', () => {
    const { onRun, onShowLens, row } = open(onFile(NARRATIVE, 3, true));

    expect(row().textContent).toContain('3 parts');
    expect(row().textContent).toContain('out of date');

    fireEvent.click(row());
    expect(onRun).toHaveBeenCalledWith(LENSES[0]);
    expect(onShowLens).not.toHaveBeenCalled();

    // What a pull request does with one: after a force-push the hunks it points
    // at are gone, so nothing is rendered and only the name survives.
    cleanup();
    const dropped = open(onFile(NARRATIVE, null, true));
    expect(dropped.row().textContent).toContain('out of date');
    expect(dropped.row().textContent).not.toContain('parts');
    fireEvent.click(dropped.row());
    expect(dropped.onRun).toHaveBeenCalledWith(LENSES[0]);

    // But not while something else is already writing: there is one run at a
    // time, and the row it would start says so by refusing the press.
    cleanup();
    const busy = open(onFile(NARRATIVE, 3, true), { writing: { id: 'other', name: 'Other' } });
    expect(busy.row().hasAttribute('disabled')).toBe(true);
  });

  test('a lens the project no longer has is named but not offered to run', () => {
    // Deleted, or posted over the CLI: there is no row in the list to start it
    // from, so the picker gives it one that only goes back to it.
    const { onRun, onShowLens } = open(onFile({ id: 'gone', name: 'Gone' }, 2, true));

    const orphan = screen.getByRole('menuitem', { name: /^Gone/ });
    expect(orphan.textContent).toContain('out of date');
    fireEvent.click(orphan);
    expect(onShowLens).toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });

  /**
   * A run costs a request and a wait. What the row can say before one starts is
   * how much of the change is going into it, and whether all of it will fit.
   */
  test('a row says what running it would send, and when it will not fit', () => {
    open(null, { promptChars: 104_000 });
    expect(screen.getByRole('menuitem', { name: /^Narrative/ }).getAttribute('title')).toContain('~26k tk');

    cleanup();
    const { row } = open(null, { promptChars: 400_000 });
    // Not a refusal — the change still runs, with the hunks that did not fit
    // sent as line spans instead of code.
    expect(row().textContent).toContain('too big to send whole');
  });

  /**
   * From the binding, not from the stored groups: a lens that names four parts
   * of a change and leaves six files out has described something else.
   */
  test('the applied row says how much of the change the lens accounts for', () => {
    const resolved: ResolvedGroup[] = [
      { id: '0', title: 'Part 0', slices: [{ path: 'a.ts', hunks: [0] }] },
      { id: '1', title: 'Part 1', slices: [{ path: 'b.ts', hunks: [0] }] },
      {
        id: 'rest',
        title: 'Not in this lens',
        slices: [
          { path: 'c.ts', hunks: [0] },
          { path: 'd.ts', hunks: [0] },
        ],
      },
    ];
    const { row } = open(onFile(NARRATIVE, 2, false), { resolved });

    expect(row().textContent).toContain('2 parts · 2 files not grouped');
  });
});
