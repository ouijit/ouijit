import { describe, test, expect } from 'vitest';

import { treeFileOrder, inTreeOrder } from '../../components/diff/DiffFileTree';

/**
 * The rail nests files by directory; the document is a flat run of them. They
 * have to agree, or clicking a file in one is no way to find it in the other
 * and scrolling the document reads as shuffled.
 */
describe('treeFileOrder', () => {
  test('files sharing a directory are brought together', () => {
    // The order a file list arrives in is GitHub's or git's, not one that
    // keeps a directory's files next to each other.
    const arrived = [{ path: 'src/db.ts' }, { path: 'docs/readme.md' }, { path: 'src/api.ts' }];

    expect(treeFileOrder(arrived)).toEqual(['src/db.ts', 'src/api.ts', 'docs/readme.md']);
  });

  test('a list already grouped is left as it is', () => {
    const arrived = [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'test/c.ts' }];
    expect(treeFileOrder(arrived)).toEqual(['src/a.ts', 'src/b.ts', 'test/c.ts']);
  });

  test('a file beside a directory keeps its place relative to it', () => {
    const arrived = [{ path: 'src/api.ts' }, { path: 'src/ui/Panel.tsx' }, { path: 'src/db.ts' }];
    expect(treeFileOrder(arrived)).toEqual(['src/api.ts', 'src/ui/Panel.tsx', 'src/db.ts']);
  });

  test('root files and nested ones both come through exactly once', () => {
    const arrived = [{ path: 'README.md' }, { path: 'src/deep/nested/thing.ts' }, { path: 'package.json' }];
    const order = treeFileOrder(arrived);

    expect(new Set(order)).toEqual(new Set(arrived.map((f) => f.path)));
    expect(order).toHaveLength(arrived.length);
  });

  test('sorting carries the rest of the file with it', () => {
    const files = [
      { path: 'src/db.ts', additions: 1 },
      { path: 'docs/readme.md', additions: 2 },
      { path: 'src/api.ts', additions: 3 },
    ];

    expect(inTreeOrder(files).map((f) => f.additions)).toEqual([1, 3, 2]);
  });

  test('an empty list is empty rather than a throw', () => {
    expect(treeFileOrder([])).toEqual([]);
    expect(inTreeOrder([])).toEqual([]);
  });
});
