/**
 * The behavioural-analysis engine, on crafted history. Everything downstream
 * is a plain rendering of what these functions produce, so the algorithms are
 * pinned here rather than at the surfaces.
 */

import { describe, test, expect } from 'vitest';
import { parseLog, parseRenamePath, type LogCommit } from '../analysis/gitLog';
import { emptyModel, foldCommits, pairKey, COUPLING_COMMIT_FILE_CAP } from '../analysis/accumulate';
import { complexityOf } from '../analysis/complexity';
import { scoreFiles } from '../analysis/score';
import { trendOf } from '../analysis/trend';
import { leversFor } from '../analysis/advice';
import { ANALYSIS_WINDOW_MONTHS, monthIndex, type FileSignal } from '../analysis/types';

const MARK = '\u0001';
const SEP = '\u0002';

function commit(sha: string, at: number, email: string, name: string, files: LogCommit['files']): LogCommit {
  return { sha, at, email, name, files };
}

describe('reading what git printed', () => {
  test('resolves every numstat path notation', () => {
    expect(parseRenamePath('src/git.ts')).toEqual({ path: 'src/git.ts' });
    expect(parseRenamePath('old.ts => new.ts')).toEqual({ path: 'new.ts', oldPath: 'old.ts' });
    expect(parseRenamePath('src/{a => b}/f.ts')).toEqual({ path: 'src/b/f.ts', oldPath: 'src/a/f.ts' });
    // One side of the braces may be empty, leaving a doubled slash.
    expect(parseRenamePath('src/{ => sub}/f.ts')).toEqual({ path: 'src/sub/f.ts', oldPath: 'src/f.ts' });
    expect(parseRenamePath('src/{sub => }/f.ts')).toEqual({ path: 'src/f.ts', oldPath: 'src/sub/f.ts' });
  });

  test('reads commits, binary counts, and renames from framed output', () => {
    const output =
      `${MARK}aaa${SEP}100${SEP}a@x${SEP}Alice\n` +
      `3\t1\tsrc/one.ts\n` +
      `-\t-\tlogo.png\n` +
      `${MARK}bbb${SEP}200${SEP}b@x${SEP}Bob\n` +
      `0\t0\told.ts => new.ts\n`;

    expect(parseLog('')).toEqual([]);

    const commits = parseLog(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ sha: 'aaa', at: 100, email: 'a@x', name: 'Alice' });
    expect(commits[0].files).toEqual([
      { path: 'src/one.ts', added: 3, deleted: 1 },
      { path: 'logo.png', added: 0, deleted: 0 },
    ]);
    expect(commits[1].files).toEqual([{ path: 'new.ts', oldPath: 'old.ts', added: 0, deleted: 0 }]);
  });
});

describe('folding commits into a model', () => {
  test('accumulates stats, authors, and coupling', () => {
    const model = emptyModel();
    foldCommits(model, [
      commit('a', 100, 'a@x', 'Alice', [
        { path: 'x.ts', added: 10, deleted: 0 },
        { path: 'y.ts', added: 5, deleted: 0 },
      ]),
      commit('b', 200, 'b@x', 'Bob', [
        { path: 'x.ts', added: 2, deleted: 1 },
        { path: 'y.ts', added: 1, deleted: 1 },
      ]),
      commit('c', 300, 'a@x', 'Alice', [{ path: 'x.ts', added: 1, deleted: 1 }]),
    ]);

    expect(model.commitCount).toBe(3);
    expect(model.files.get('x.ts')).toEqual({
      commits: 3,
      added: 13,
      deleted: 2,
      byMonth: new Map([[monthIndex(100), 3]]),
    });
    expect(model.authors.get('x.ts')?.get('a@x')).toEqual({ name: 'Alice', commits: 2 });
    expect(model.couplings.get(pairKey('x.ts', 'y.ts'))).toBe(2);
  });

  test('a rename carries the file history forward, coupling included', () => {
    const model = emptyModel();
    foldCommits(model, [
      commit('a', 100, 'a@x', 'Alice', [
        { path: 'old.ts', added: 10, deleted: 0 },
        { path: 'other.ts', added: 1, deleted: 0 },
      ]),
      commit('b', 200, 'a@x', 'Alice', [
        { path: 'old.ts', added: 2, deleted: 0 },
        { path: 'other.ts', added: 1, deleted: 0 },
      ]),
      commit('c', 300, 'b@x', 'Bob', [{ path: 'new.ts', oldPath: 'old.ts', added: 0, deleted: 0 }]),
      commit('d', 400, 'b@x', 'Bob', [{ path: 'new.ts', added: 3, deleted: 1 }]),
    ]);

    expect(model.files.has('old.ts')).toBe(false);
    expect(model.files.get('new.ts')).toMatchObject({ commits: 4, added: 15, deleted: 1 });
    expect(model.files.get('new.ts')?.byMonth.get(monthIndex(100))).toBe(4);
    expect(model.authors.get('new.ts')?.get('a@x')?.commits).toBe(2);
    expect(model.couplings.get(pairKey('new.ts', 'other.ts'))).toBe(2);
    expect(model.couplings.get(pairKey('old.ts', 'other.ts'))).toBeUndefined();
  });

  test('a bulk commit counts for frequency but not for coupling', () => {
    const model = emptyModel();
    const bulk = Array.from({ length: COUPLING_COMMIT_FILE_CAP + 1 }, (_, i) => ({
      path: `f${i}.ts`,
      added: 1,
      deleted: 0,
    }));
    foldCommits(model, [commit('a', 100, 'a@x', 'Alice', bulk)]);

    expect(model.files.size).toBe(COUPLING_COMMIT_FILE_CAP + 1);
    expect(model.couplings.size).toBe(0);
  });

  test('directories roll up whole subtrees, counting a commit once each', () => {
    const model = emptyModel();
    foldCommits(model, [
      commit('a', 100, 'a@x', 'Alice', [
        { path: 'src/ui/one.ts', added: 10, deleted: 1 },
        { path: 'src/ui/two.ts', added: 5, deleted: 0 },
        { path: 'src/db/three.ts', added: 2, deleted: 0 },
      ]),
      commit('b', 200, 'a@x', 'Alice', [{ path: 'src/ui/one.ts', added: 1, deleted: 0 }]),
      commit('c', 300, 'a@x', 'Alice', [{ path: 'README.md', added: 1, deleted: 0 }]),
    ]);

    // Two files in src/ui on one commit is one commit for src/ui, and for src.
    expect(model.dirs.get('src/ui')?.commits).toBe(2);
    expect(model.dirs.get('src')?.commits).toBe(2);
    expect(model.dirs.get('src/db')?.commits).toBe(1);
    // A file at the repo root belongs to no directory.
    expect(model.dirs.has('')).toBe(false);

    // Coupling is between the directories files sit in, not their ancestors.
    expect(model.dirCouplings.get(pairKey('src/ui', 'src/db'))).toBe(1);
    expect(model.dirCouplings.get(pairKey('src', 'src/ui'))).toBeUndefined();

    expect(model.commitsByMonth.get(monthIndex(100))).toBe(3);
  });
});

describe('where the activity is heading', () => {
  const months = (...counts: number[]) => {
    const monthly = new Array<number>(ANALYSIS_WINDOW_MONTHS).fill(0);
    counts.forEach((n, i) => (monthly[monthly.length - counts.length + i] = n));
    return monthly;
  };

  test('reads direction from the recent months against the rest', () => {
    expect(trendOf(months(0, 0, 0, 0, 0, 0, 1, 1, 1, 6, 6, 6)).direction).toBe('rising');
    expect(trendOf(months(6, 6, 6, 6, 6, 6, 6, 6, 6, 0, 0, 1)).direction).toBe('cooling');
    expect(trendOf(months(2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2)).direction).toBe('steady');
    // Nothing before the recent window at all.
    expect(trendOf(months(0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 1))).toMatchObject({
      direction: 'new',
      recent: 6,
      total: 6,
    });
    // Too little either side to read a direction from, whatever the shape.
    expect(trendOf(months(0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2)).direction).toBe('steady');
  });
});

describe('what a hotspot argues for', () => {
  function signal(over: Partial<FileSignal> = {}): FileSignal {
    return {
      commits: 20,
      added: 200,
      deleted: 100,
      score: 0.9,
      tier: 'hot',
      freqRank: 0.98,
      cxRank: 0.95,
      monthly: new Array<number>(ANALYSIS_WINDOW_MONTHS).fill(1),
      trend: { direction: 'rising', recent: 12, total: 20 },
      topAuthors: [{ name: 'Alice', share: 0.5 }],
      authorCount: 2,
      complexity: { loc: 800, indentTotal: 1600, indentMax: 8 },
      ...over,
    };
  }

  test('names the moves the numbers argue for, at most three', () => {
    const levers = leversFor(signal({ added: 4000, deleted: 1000, topAuthors: [{ name: 'Alice', share: 0.95 }] }), {
      path: 'src/other.ts',
      degree: 0.9,
    });
    expect(levers.map((l) => l.id)).toEqual(['split', 'flatten', 'churn']);
  });

  test('a cooling file argues against every other move', () => {
    const levers = leversFor(signal({ trend: { direction: 'cooling', recent: 1, total: 20 } }));
    expect(levers.map((l) => l.id)).toEqual(['cooling']);
  });

  test('each lever answers to its own numbers, and says nothing without them', () => {
    // Small, shallow and barely churned, so only the lever under test fires.
    const unremarkable = { added: 20, deleted: 5, complexity: { loc: 90, indentTotal: 90, indentMax: 3 } };

    expect(leversFor(signal({ tier: 'quiet' }))).toEqual([]);
    expect(leversFor(signal({ ...unremarkable, authorCount: 2 }))).toEqual([]);

    const ids = (over: Partial<FileSignal>, partner?: { path: string; degree: number }) =>
      leversFor(signal({ ...unremarkable, ...over }), partner).map((l) => l.id);

    expect(ids({ topAuthors: [{ name: 'Alice', share: 0.9 }] })).toEqual(['held']);
    // Concentration and fragmentation are the same question, so never both.
    expect(ids({ authorCount: 6, topAuthors: [{ name: 'Alice', share: 0.2 }] })).toEqual(['fragmented']);
    expect(ids({}, { path: 'src/deep/other.ts', degree: 0.85 })).toEqual(['seam']);
    // A loose partner is a coincidence rather than a seam.
    expect(ids({}, { path: 'src/deep/other.ts', degree: 0.55 })).toEqual([]);

    const seam = leversFor(signal(unremarkable), { path: 'src/deep/other.ts', degree: 0.85 });
    expect(seam[0].text).toContain('other.ts');
    expect(seam[0].text).not.toContain('src/deep');
  });
});

describe('what makes a file hot', () => {
  test('counts non-blank lines and logical indentation', () => {
    const text = 'a\n' + '    b\n' + '\tc\n' + '\n' + '   \n' + '        d\n';
    expect(complexityOf(text)).toEqual({ loc: 4, indentTotal: 4, indentMax: 2 });
  });

  test('only frequent and complex files reach hot; unread files stay quiet', () => {
    const model = emptyModel();
    // 20 quiet one-commit files under two frequent ones, one of which was
    // never read for complexity.
    const commits: LogCommit[] = [];
    for (let i = 0; i < 20; i++) {
      commits.push(commit(`q${i}`, 100 + i, 'a@x', 'Alice', [{ path: `quiet${i}.ts`, added: 1, deleted: 0 }]));
    }
    for (let i = 0; i < 10; i++) {
      commits.push(
        commit(`h${i}`, 200 + i, 'a@x', 'Alice', [
          { path: 'hot.ts', added: 1, deleted: 0 },
          { path: 'unread.ts', added: 1, deleted: 0 },
        ]),
      );
    }
    foldCommits(model, commits);

    const complexity = new Map([['hot.ts', { loc: 400, indentTotal: 900, indentMax: 6 }]]);
    for (let i = 0; i < 20; i++) {
      complexity.set(`quiet${i}.ts`, { loc: 10, indentTotal: i, indentMax: 1 });
    }
    const scores = scoreFiles(model, complexity);

    expect(scores.get('hot.ts')?.tier).toBe('hot');
    expect(scores.get('quiet0.ts')?.tier).toBe('quiet');
    expect(scores.get('unread.ts')).toMatchObject({ score: 0, tier: 'quiet', cxRank: null });
    expect(scores.get('unread.ts')?.freqRank).toBeGreaterThan(0.8);
  });

  test('topping both ranks is not enough without the commits to mean it', () => {
    const model = emptyModel();
    const commits: LogCommit[] = [];
    for (let i = 0; i < 20; i++) {
      commits.push(commit(`q${i}`, 100 + i, 'a@x', 'Alice', [{ path: `quiet${i}.ts`, added: 1, deleted: 0 }]));
    }
    for (let i = 0; i < 3; i++) {
      commits.push(commit(`t${i}`, 200 + i, 'a@x', 'Alice', [{ path: 'top.ts', added: 1, deleted: 0 }]));
    }
    foldCommits(model, commits);

    const complexity = new Map([['top.ts', { loc: 400, indentTotal: 900, indentMax: 6 }]]);
    for (let i = 0; i < 20; i++) complexity.set(`quiet${i}.ts`, { loc: 10, indentTotal: i, indentMax: 1 });
    const scores = scoreFiles(model, complexity);

    // Top of the project on both ranks, and hot on score alone — three commits
    // is what holds it back, which is what keeps a young repo from being all
    // hotspots.
    expect(scores.get('top.ts')?.score).toBeGreaterThan(0.85);
    expect(scores.get('top.ts')?.tier).toBe('warm');
  });
});
