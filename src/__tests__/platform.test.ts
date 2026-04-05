import { describe, test, expect, vi } from 'vitest';
import { trashItem, setTrashItem } from '../platform';

describe('platform', () => {
  test('setTrashItem overrides the default trash behavior', async () => {
    const trashed: string[] = [];
    setTrashItem(async (p) => {
      trashed.push(p);
    });

    await trashItem('/some/path');
    expect(trashed).toEqual(['/some/path']);

    // Reset to avoid side effects
    setTrashItem(async () => {});
  });

  test('trashItem delegates to the set function', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    setTrashItem(fn);
    await trashItem('/test/dir');
    expect(fn).toHaveBeenCalledWith('/test/dir');

    setTrashItem(async () => {});
  });
});
