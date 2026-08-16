import { describe, test, expect } from 'vitest';
import { groupDiffBases, searchDiffBases, MAX_BASE_ROWS } from '../components/diff/diffBaseGroups';
import type { DiffBaseRef, DiffBases } from '../types';

function refs(...names: string[]): DiffBaseRef[] {
  return names.map((ref) => {
    const remote = ref.startsWith('origin/') || ref.startsWith('upstream/') ? ref.slice(0, ref.indexOf('/')) : null;
    return { ref, branch: remote ? ref.slice(ref.indexOf('/') + 1) : ref, remote };
  });
}

function bases(names: string[], extra: Partial<DiffBases> = {}): DiffBases {
  return { refs: refs(...names), upstream: null, defaultRemote: 'origin', lastFetch: null, ...extra };
}

const ON_FEAT = { branch: 'feat/x', base: 'main', mainBranch: 'main' };

describe('the refs that mean something to this branch', () => {
  test('the base, the base on the remote, and the branch as pushed', () => {
    const groups = groupDiffBases(
      bases(['main', 'origin/main', 'feat/x', 'origin/feat/x'], { upstream: 'origin/feat/x' }),
      ON_FEAT,
    );
    expect(groups.roles).toEqual([
      { ref: 'main', hint: 'base' },
      { ref: 'origin/main', hint: 'base on origin' },
      { ref: 'origin/feat/x', hint: 'pushed' },
    ]);
  });

  test('a branch never pushed is not offered as one that was', () => {
    const groups = groupDiffBases(bases(['main', 'origin/main', 'feat/x']), ON_FEAT);
    expect(groups.roles.map((r) => r.ref)).toEqual(['main', 'origin/main']);
  });

  test('main stays one row away when the task branched off something else', () => {
    const groups = groupDiffBases(bases(['main', 'origin/main', 'parent', 'origin/parent', 'feat/x']), {
      branch: 'feat/x',
      base: 'parent',
      mainBranch: 'main',
    });
    expect(groups.roles).toEqual([
      { ref: 'parent', hint: 'base' },
      { ref: 'origin/parent', hint: 'base on origin' },
      { ref: 'main', hint: 'main' },
      { ref: 'origin/main', hint: 'main on origin' },
    ]);
  });

  test('the base being main does not put main in twice', () => {
    const groups = groupDiffBases(bases(['main', 'origin/main', 'feat/x']), ON_FEAT);
    expect(groups.roles.filter((r) => r.ref === 'main')).toHaveLength(1);
  });

  test('a fork keeps its own remote for the roles', () => {
    const groups = groupDiffBases(
      bases(['main', 'upstream/main', 'origin/main', 'feat/x'], { defaultRemote: 'upstream' }),
      ON_FEAT,
    );
    expect(groups.roles.map((r) => r.ref)).toEqual(['main', 'upstream/main']);
    expect(groups.rest.map((r) => r.ref)).toContain('origin/main');
  });
});

describe('everything else', () => {
  test('alphabetically, with each branch beside the remotes carrying it', () => {
    const listed = bases(['main', 'origin/main', 'feat/x', 'apple', 'origin/apple']).refs.sort((a, b) =>
      a.branch.localeCompare(b.branch),
    );
    const groups = groupDiffBases({ ...bases([]), refs: listed }, ON_FEAT);
    expect(groups.rest.map((r) => r.ref)).toEqual(['apple', 'origin/apple']);
  });

  test('never offers the branch being read as its own base', () => {
    const groups = groupDiffBases(bases(['main', 'feat/x']), ON_FEAT);
    expect(groups.roles.concat(groups.rest).map((r) => r.ref)).not.toContain('feat/x');
  });

  test('says how many it is holding back rather than trailing off', () => {
    const many = Array.from({ length: MAX_BASE_ROWS + 4 }, (_, i) => `branch-${String(i).padStart(2, '0')}`);
    const groups = groupDiffBases(bases(['main', ...many]), ON_FEAT);
    expect(groups.rest).toHaveLength(MAX_BASE_ROWS);
    expect(groups.hidden).toBe(4);
  });
});

describe('finding a branch by typing', () => {
  test('one flat list, best match first', () => {
    const found = searchDiffBases(refs('main', 'origin/main', 'maintenance', 'feat/x'), 'main', 'feat/x');
    expect(found[0].ref).toBe('main');
    expect(found.map((r) => r.ref)).toContain('origin/main');
  });

  test('the remote prefix does not have to be typed to reach a remote branch', () => {
    const found = searchDiffBases(refs('origin/release'), 'release', null);
    expect(found.map((r) => r.ref)).toEqual(['origin/release']);
  });

  test('nothing that does not match', () => {
    expect(searchDiffBases(refs('main', 'origin/main'), 'zzz', null)).toEqual([]);
  });
});
