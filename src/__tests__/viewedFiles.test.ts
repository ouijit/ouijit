import { describe, test, expect, beforeEach, vi } from 'vitest';

const settings = new Map<string, string>();

vi.mock('../db', () => ({
  getGlobalSetting: vi.fn(async (key: string) => settings.get(key)),
  setGlobalSetting: vi.fn(async (key: string, value: string) => {
    settings.set(key, value);
  }),
}));

const { getViewedFiles, setFileViewed, viewedFilesKey } = await import('../github/viewedFiles');

const PROJECT = '/work/alpha';

describe('files marked as read', () => {
  beforeEach(() => {
    settings.clear();
  });

  test('what has been marked comes back', async () => {
    await setFileViewed(PROJECT, 5, 'head-1', 'src/a.ts', true);
    await setFileViewed(PROJECT, 5, 'head-1', 'src/b.ts', true);

    expect(await getViewedFiles(PROJECT, 5, 'head-1')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('unmarking removes it, and marking twice does not duplicate it', async () => {
    await setFileViewed(PROJECT, 5, 'head-1', 'src/a.ts', true);
    await setFileViewed(PROJECT, 5, 'head-1', 'src/a.ts', true);
    expect(await getViewedFiles(PROJECT, 5, 'head-1')).toEqual(['src/a.ts']);

    await setFileViewed(PROJECT, 5, 'head-1', 'src/a.ts', false);
    expect(await getViewedFiles(PROJECT, 5, 'head-1')).toEqual([]);
  });

  /**
   * The rule the feature rests on: a file you read and someone then pushed to
   * is a file you have not read.
   */
  test('a new head clears what was marked against the old one', async () => {
    await setFileViewed(PROJECT, 5, 'head-1', 'src/a.ts', true);

    expect(await getViewedFiles(PROJECT, 5, 'head-2')).toEqual([]);

    // Writing against the new head does not restore the old set.
    await setFileViewed(PROJECT, 5, 'head-2', 'src/b.ts', true);
    expect(await getViewedFiles(PROJECT, 5, 'head-2')).toEqual(['src/b.ts']);
  });

  test('pull requests are kept apart', async () => {
    await setFileViewed(PROJECT, 5, 'head-1', 'src/a.ts', true);
    await setFileViewed(PROJECT, 6, 'head-1', 'src/b.ts', true);

    expect(await getViewedFiles(PROJECT, 5, 'head-1')).toEqual(['src/a.ts']);
    expect(await getViewedFiles(PROJECT, 6, 'head-1')).toEqual(['src/b.ts']);
    expect(viewedFilesKey(PROJECT, 5)).not.toBe(viewedFilesKey(PROJECT, 6));
  });

  test('unreadable storage reads as nothing marked rather than throwing', async () => {
    settings.set(viewedFilesKey(PROJECT, 5), 'not json');
    expect(await getViewedFiles(PROJECT, 5, 'head-1')).toEqual([]);

    settings.set(viewedFilesKey(PROJECT, 5), JSON.stringify({ headSha: 'head-1', paths: 'nope' }));
    expect(await getViewedFiles(PROJECT, 5, 'head-1')).toEqual([]);
  });
});
