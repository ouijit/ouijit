import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { DiffLensRow } from '../db/repos/diffLensRepo';
import type { DiffSubject } from '../lens/subject';

/**
 * One reader for both diffs, and the one thing they disagree about.
 *
 * The two diffs genuinely disagree about what a drifted lens is worth drawing,
 * and that is the only thing they disagree about. A reader each would be two
 * staleness rules neither of them states — it is a property of the subject
 * instead, and this is what each setting means.
 */

const rows = new Map<string, DiffLensRow>();

vi.mock('../db', () => ({
  getDiffLens: vi.fn(async (projectPath: string, subjectKey: string) => rows.get(`${projectPath}\0${subjectKey}`)),
  deleteDiffLens: vi.fn(async (projectPath: string, subjectKey: string) => {
    rows.delete(`${projectPath}\0${subjectKey}`);
    return { success: true };
  }),
}));

const { readLens, clearLens } = await import('../lens/readLens');

const PROJECT = '/work/alpha';
const GROUPS = JSON.stringify({ groups: [{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }] });

function store(
  pin: string,
  groups = GROUPS,
  lens: { id: string; name: string } | null = { id: 'lens-1', name: 'Narrative' },
): void {
  rows.set(`${PROJECT}\0subject`, {
    project_path: PROJECT,
    subject_key: 'subject',
    pin,
    groups,
    lens_id: lens?.id ?? null,
    lens_name: lens?.name ?? null,
    created_at: '2026-08-01T00:00:00.000Z',
  });
}

/** Only the four things reading a lens actually asks a subject for. */
function subject(whenStale: 'drop' | 'render', pin = 'head-1'): DiffSubject {
  return {
    projectPath: PROJECT,
    key: 'subject',
    cwd: PROJECT,
    label: {},
    whenStale,
    pin: () => Promise.resolve(pin),
    listFiles: () => Promise.resolve({ files: [], emptyMessage: '' }),
    diffFor: () => Promise.resolve(null),
    describe: () => ({ lead: '', heading: '' }),
  };
}

describe('reading the lens on file', () => {
  beforeEach(() => rows.clear());

  test('nothing written is null, not an empty result', async () => {
    expect(await readLens(subject('drop'))).toBeNull();
  });

  test('a lens that still fits comes back whole, either way', async () => {
    store('head-1');

    for (const whenStale of ['drop', 'render'] as const) {
      const lens = await readLens(subject(whenStale));
      expect(lens?.stale).toBe(false);
      expect(lens?.lensId).toBe('lens-1');
      expect(lens?.groups?.map((g) => g.title)).toEqual(['Transport']);
    }
  });

  /**
   * A pull request's hunks are gone after a force-push, so drawing the lens
   * would describe code that is no longer there. It is still named: the picker
   * cannot offer to write it again without knowing which lens wrote it.
   */
  test('a pull request drops a drifted lens but keeps its name', async () => {
    store('older-sha');

    const lens = await readLens(subject('drop'));
    expect(lens).toEqual({ groups: null, lensId: 'lens-1', lensName: 'Narrative', stale: true });
  });

  /**
   * A working tree moves on every save, so a lens written a minute ago still
   * groups most of it — and `resolveLens` puts what it no longer claims in a
   * trailing group, so drift costs grouping rather than hiding a change.
   */
  test('a worktree keeps drawing a drifted lens, and says it drifted', async () => {
    store('shape:older');

    const lens = await readLens(subject('render'));
    expect(lens?.stale).toBe(true);
    expect(lens?.groups?.map((g) => g.title)).toEqual(['Transport']);
  });

  test('a lens posted over the CLI has no lens to offer', async () => {
    store('head-1', GROUPS, null);

    const lens = await readLens(subject('render'));
    expect(lens?.lensId).toBeNull();
    expect(lens?.lensName).toBeNull();
  });

  test('a row that will not parse leaves nothing to draw', async () => {
    store('head-1', 'not json at all');

    const lens = await readLens(subject('render'));
    expect(lens?.groups).toBeNull();
    expect(lens?.stale).toBe(false);
  });

  test('clearing it is keyed by the subject, so the next read finds nothing', async () => {
    store('head-1');

    expect(await clearLens(subject('drop'))).toEqual({ success: true });
    expect(await readLens(subject('drop'))).toBeNull();
  });
});
