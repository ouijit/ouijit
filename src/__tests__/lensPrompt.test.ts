import { describe, test, expect } from 'vitest';
import { buildLensPrompt } from '../lens/lensPrompt';
import { hunkSpan } from '../lens/lens';
import type { FileDiff } from '../types';
import type { PullRequestDetail, PullRequestFile } from '../github/types';
import type { DiffSignals, FileAnalysis } from '../analysis/types';
import { hunk } from './lensFixtures';

function file(path: string, over: Partial<PullRequestFile> = {}): PullRequestFile {
  return { path, status: 'M', additions: 1, deletions: 0, ...over };
}

const detail = {
  number: 264,
  title: 'Agent-composable review',
  body: 'why this change exists',
  baseSha: 'aaa',
  headSha: 'bbb',
} as PullRequestDetail;

/** What `writeLensWithAgent` passes for a pull request. */
const subject = {
  lead: 'You are grouping the changes in a pull request so a reviewer can read them in a sensible order.',
  heading: `# Pull request #${detail.number}: ${detail.title}`,
  body: detail.body,
};

function prompt(
  files: PullRequestFile[],
  diffs: Map<string, FileDiff | null>,
  budget?: number,
  signals?: DiffSignals | null,
) {
  return buildLensPrompt({ subject, files, diffs, instruction: 'group it by story', budget, signals }).prompt;
}

/** One path's analysis, filled out enough for the prompt to read it. */
function analysed(over: { score?: number; rising?: boolean; missing?: string[] }): FileAnalysis {
  return {
    signal: {
      score: over.score ?? 0,
      tier: 'quiet',
      freqRank: 0,
      cxRank: null,
      commits: 42,
      added: 0,
      deleted: 0,
      monthly: [],
      trend: { direction: over.rising ? 'rising' : 'steady', slope: 0 },
      topAuthors: [],
      authorCount: 1,
      complexity: null,
    },
    missing: (over.missing ?? []).map((path) => ({ path, degree: 0.9 })),
  };
}

describe('the prompt a lens run is given', () => {
  test('carries what the agent would otherwise have to go and find', () => {
    const diffs = new Map<string, FileDiff | null>([
      ['src/a.ts', { path: 'src/a.ts', hunks: [hunk(1, 3, 'fn go()'), hunk(50, 4)] }],
    ]);
    const text = prompt([file('src/a.ts')], diffs);

    expect(text).toContain('#264');
    expect(text).toContain('Agent-composable review');
    expect(text).toContain('why this change exists');
    expect(text).toContain('src/a.ts');
    expect(text).toContain('fn go()');
    expect(text).toContain('line 1');
    expect(text).toContain('group it by story');

    // The spans the answer has to be given in: nothing else says what they are.
    expect(text).toContain('[0] lines 1-3');
    expect(text).toContain('[1] lines 50-53');

    // What a lens instruction never has to say for itself.
    expect(text).toContain('cannot give every');
    expect(text).toContain('Mechanical work goes last');
    expect(text).toContain('A title names the part');
  });

  test('the budget is a ceiling, and every file is named under it', () => {
    const diffs = new Map<string, FileDiff | null>();
    const files: PullRequestFile[] = [];
    for (let i = 0; i < 40; i++) {
      const path = `src/file${i}.ts`;
      files.push(file(path));
      diffs.set(path, { path, hunks: [hunk(1, 200)] });
    }

    const text = prompt(files, diffs, 4_000);

    expect(text.length).toBeLessThan(4_000);
    for (const f of files) expect(text).toContain(f.path);
    expect(text).toMatch(/hunks? below the budget/);
  });

  test('a file with no readable text is named for what it is, not left out', () => {
    const diffs = new Map<string, FileDiff | null>([
      ['assets/logo.png', { path: 'assets/logo.png', hunks: [], binary: true }],
      ['src/gone.ts', null],
      ['src/new.ts', { path: 'src/new.ts', hunks: [hunk(1, 2)] }],
    ]);
    const text = prompt(
      [file('assets/logo.png'), file('src/gone.ts'), file('src/new.ts', { oldPath: 'src/old.ts' })],
      diffs,
    );

    expect(text).toContain('assets/logo.png');
    expect(text).toContain('(binary)');
    expect(text).toContain('src/gone.ts');
    expect(text).toContain('(diff unavailable)');
    expect(text).toContain('renamed from src/old.ts');
  });

  test('a hunk is asked about by the new-file lines it covers', () => {
    expect(hunkSpan(hunk(10, 5))).toEqual([10, 14]);
    // Nothing in the new file is nothing a lens can point at.
    expect(hunkSpan({ header: '@@ -1,2 +0,0 @@', lines: [{ type: 'deletion', content: 'gone', oldLineNo: 1 }] })).toBe(
      null,
    );
  });
});

describe('what the history says', () => {
  const files = [file('src/hot.ts'), file('src/quiet.ts')];
  const diffs = new Map<string, FileDiff | null>([
    ['src/hot.ts', { path: 'src/hot.ts', hunks: [hunk(1, 2)] }],
    ['src/quiet.ts', { path: 'src/quiet.ts', hunks: [hunk(1, 2)] }],
  ]);

  test('names only the files that stand out, and why', () => {
    const signals: DiffSignals = {
      'src/hot.ts': analysed({ score: 0.9, rising: true, missing: ['src/migrations/014.ts'] }),
      'src/quiet.ts': analysed({ score: 0.1 }),
    };

    const said = prompt(files, diffs, undefined, signals).split('# What the history says')[1].split('\n# ')[0];
    expect(said).toContain('src/hot.ts — changed often and deeply nested (42 commits)');
    expect(said).toContain('changing more lately than it used to');
    expect(said).toContain('usually changes with src/migrations/014.ts, absent here');
    // A score for every path is a table nobody reads.
    expect(said).not.toContain('src/quiet.ts');
  });

  test('says nothing at all with the analysis flag off, which is the usual case', () => {
    expect(prompt(files, diffs, undefined, null)).not.toContain('What the history says');
    // Nor when it is on and every file in the change is unremarkable.
    expect(prompt(files, diffs, undefined, { 'src/quiet.ts': analysed({ score: 0.1 }) })).not.toContain(
      'What the history says',
    );
  });
});
