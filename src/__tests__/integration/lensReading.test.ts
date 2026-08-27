/**
 * One reader for both diffs, and the one thing they disagree about: whether a
 * lens that no longer fits is still worth drawing. The subject here is a stub so
 * the pin can be wrong on demand; `lensLifetime.test.ts` runs it over real refs.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { _resetCacheForTesting, saveDiffLens, startDiffLensRun } from '../../db';
import { saveLens } from '../../lens/config';
import { readLens, clearLens } from '../../lens/readLens';
import type { DiffSubject } from '../../lens/subject';

const PROJECT = '/work/alpha';
const KEY = 'subject';
const GROUPS = JSON.stringify({ groups: [{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }] });

/** Only the four things reading a lens actually asks a subject for. */
function subject(whenStale: 'drop' | 'render', pin = 'head-1'): DiffSubject {
  return {
    projectPath: PROJECT,
    key: KEY,
    label: {},
    whenStale,
    pin: () => Promise.resolve(pin),
    listFiles: () => Promise.resolve({ files: [], emptyMessage: '' }),
    diffFor: () => Promise.resolve(null),
    describe: () => ({ lead: '', heading: '' }),
  };
}

const LENS = { id: 'lens-1', name: 'Narrative' };

function store(pin: string, groups = GROUPS, lens: { id: string; name: string } | null = LENS): Promise<void> {
  return saveDiffLens(PROJECT, KEY, pin, groups, lens);
}

beforeEach(async () => {
  _resetCacheForTesting();
});

describe('reading the lens on file', () => {
  test('nothing written is null, not an empty result', async () => {
    expect(await readLens(subject('drop'))).toBeNull();
  });

  test('a lens that still fits comes back whole, whichever diff is reading it', async () => {
    await store('head-1');

    for (const whenStale of ['drop', 'render'] as const) {
      const lens = await readLens(subject(whenStale));
      expect(lens?.stale).toBe(false);
      expect(lens?.lensId).toBe('lens-1');
      expect(lens?.groups?.map((group) => group.title)).toEqual(['Transport']);
    }
  });

  test('drift drops a pull request lens by name, and leaves a worktree one drawn', async () => {
    await store('older-sha');

    expect(await readLens(subject('drop'))).toEqual({
      groups: null,
      lensId: 'lens-1',
      lensName: 'Narrative',
      stale: true,
      omitted: 0,
      running: null,
    });

    const rendered = await readLens(subject('render'));
    expect(rendered?.stale).toBe(true);
    expect(rendered?.groups?.map((group) => group.title)).toEqual(['Transport']);
  });

  test('a grouping with no lens behind it, and one that will not parse, leave nothing to offer', async () => {
    // Posted over the CLI: there is a grouping but no lens to run again.
    await store('head-1', GROUPS, null);
    const posted = await readLens(subject('render'));
    expect(posted?.lensId).toBeNull();
    expect(posted?.lensName).toBeNull();

    await store('head-1', 'not json at all');
    const unreadable = await readLens(subject('render'));
    expect(unreadable?.groups).toBeNull();
    expect(unreadable?.stale).toBe(false);
  });

  test('a run that has not answered yet is a row with no grouping in it', async () => {
    const lens = await saveLens(PROJECT, { name: 'Narrative', instruction: 'group by story' });
    await startDiffLensRun(PROJECT, KEY, lens.id);

    const reading = await readLens(subject('drop'));
    expect(reading?.groups).toBeNull();
    expect(reading?.stale).toBe(false);
    expect(reading?.running?.lensName).toBe('Narrative');
    // Not this process, so it is a run to offer again rather than one to wait on.
    expect(reading?.running?.live).toBe(false);
  });

  test('clearing it is keyed by the subject, so the next read finds nothing', async () => {
    await store('head-1');

    expect(await clearLens(subject('drop'))).toEqual({ success: true });
    expect(await readLens(subject('drop'))).toBeNull();
  });
});
