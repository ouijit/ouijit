import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { treeFileOrder, inTreeOrder, DiffFileTreeNodes } from '../../components/diff/DiffFileTree';
import type { ChangedFile } from '../../types';

/**
 * The rail nests files by directory; the document is a flat run of them. The
 * two orders have to agree, or a file clicked in one cannot be found in the
 * other.
 */
describe('treeFileOrder', () => {
  test('directories are gathered, nested ones first, and nothing is lost', () => {
    // The order a file list arrives in is GitHub's or git's, not one that keeps
    // a directory's files next to each other.
    const arrived = [
      { path: 'src/db.ts', additions: 1 },
      { path: 'docs/readme.md', additions: 2 },
      { path: 'src/api.ts', additions: 3 },
      { path: 'src/ui/Panel.tsx', additions: 4 },
      { path: 'README.md', additions: 5 },
    ];

    expect(treeFileOrder(arrived)).toEqual([
      'docs/readme.md',
      'src/ui/Panel.tsx',
      'src/api.ts',
      'src/db.ts',
      'README.md',
    ]);
    // inTreeOrder is the same order with the whole file carried along.
    expect(inTreeOrder(arrived).map((f) => f.additions)).toEqual([2, 4, 3, 1, 5]);
  });

  test('an empty list is empty rather than a throw', () => {
    expect(treeFileOrder([])).toEqual([]);
    expect(inTreeOrder([])).toEqual([]);
  });

  /**
   * Against the tree itself, not against a description of it: the sort has to
   * live in the walk both the rail and the document read, and a sort applied at
   * the point of rendering is one nothing computing an order can see.
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
