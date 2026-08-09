import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { treeFileOrder, inTreeOrder, DiffFileTreeNodes } from '../../components/diff/DiffFileTree';
import type { ChangedFile } from '../../types';

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

    expect(treeFileOrder(arrived)).toEqual(['docs/readme.md', 'src/api.ts', 'src/db.ts']);
  });

  test('a list already grouped is left as it is', () => {
    const arrived = [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'test/c.ts' }];
    expect(treeFileOrder(arrived)).toEqual(['src/a.ts', 'src/b.ts', 'test/c.ts']);
  });

  test('a directory comes before the files beside it', () => {
    const arrived = [{ path: 'src/api.ts' }, { path: 'src/ui/Panel.tsx' }, { path: 'src/db.ts' }];
    expect(treeFileOrder(arrived)).toEqual(['src/ui/Panel.tsx', 'src/api.ts', 'src/db.ts']);
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

    expect(inTreeOrder(files).map((f) => f.additions)).toEqual([2, 3, 1]);
  });

  test('an empty list is empty rather than a throw', () => {
    expect(treeFileOrder([])).toEqual([]);
    expect(inTreeOrder([])).toEqual([]);
  });

  /**
   * The one that matters, and the one that was missing: the order this function
   * reports is the order the rail draws. It was checked against a description of
   * the tree rather than against the tree, and the two had drifted — the sort
   * lived at the point of rendering, where nothing computing an order could see
   * it, so every directory with more than one thing in it read differently in
   * the rail than in the document.
   */
  test('the reported order is the order the rail renders', () => {
    const paths = [
      'src/db.ts',
      'docs/readme.md',
      'src/api.ts',
      'src/ui/Panel.tsx',
      'README.md',
      'src/ui/Bar.tsx',
      'e2e/run.ts',
    ];
    const files: ChangedFile[] = paths.map((path) => ({ path, status: 'M', additions: 1, deletions: 1 }));

    render(<DiffFileTreeNodes files={files} onFileClick={() => {}} />);

    const rendered = screen.getAllByText(/\.(ts|tsx|md)$/).map((node) => node.closest('[data-path]'));
    const rail = rendered.map((row) => row?.getAttribute('data-path'));

    expect(rail).toEqual(treeFileOrder(files));
  });
});
