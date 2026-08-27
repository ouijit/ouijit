import { describe, test, expect } from 'vitest';
import { buildLensPrompt, hunkSpan } from '../lens/lensPrompt';
import { resolveLensAgent, pickLensAgent, installedAgents, LENS_AGENTS } from '../lens/lensAgents';
import type { FileDiff } from '../types';
import type { PullRequestDetail, PullRequestFile } from '../github/types';
import type { DiffSignals, FileAnalysis } from '../analysis/types';

function hunk(start: number, count: number, context = '') {
  return {
    header: `@@ -${start},${count} +${start},${count} @@ ${context}`,
    lines: Array.from({ length: count }, (_, i) => ({
      type: 'addition' as const,
      content: `line ${start + i}`,
      newLineNo: start + i,
    })),
  };
}

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

describe('buildLensPrompt', () => {
  test('carries what the agent would otherwise have to go and find', () => {
    const diffs = new Map<string, FileDiff | null>([
      ['src/a.ts', { path: 'src/a.ts', hunks: [hunk(1, 3, 'fn go()')] }],
    ]);
    const text = prompt([file('src/a.ts')], diffs);

    // The whole point: no tool call can be needed for any of this.
    expect(text).toContain('#264');
    expect(text).toContain('Agent-composable review');
    expect(text).toContain('why this change exists');
    expect(text).toContain('src/a.ts');
    expect(text).toContain('fn go()');
    expect(text).toContain('line 1');
    expect(text).toContain('group it by story');
  });

  test('states the line spans a lens has to answer in', () => {
    const diffs = new Map<string, FileDiff | null>([
      ['src/a.ts', { path: 'src/a.ts', hunks: [hunk(1, 3), hunk(50, 4)] }],
    ]);
    const text = prompt([file('src/a.ts')], diffs);

    expect(text).toContain('[0] lines 1-3');
    expect(text).toContain('[1] lines 50-53');
  });

  /**
   * The rule the budget exists to protect. A grouping that was never told a
   * file exists can only leave it out, and leaving a file out of a review is
   * the one failure a lens must not have.
   */
  test('every file is named however small the budget', () => {
    const diffs = new Map<string, FileDiff | null>();
    const files: PullRequestFile[] = [];
    for (let i = 0; i < 40; i++) {
      const path = `src/file${i}.ts`;
      files.push(file(path));
      diffs.set(path, { path, hunks: [hunk(1, 200)] });
    }

    const text = prompt(files, diffs, 4_000);

    for (const f of files) expect(text).toContain(f.path);
    // And it says so, rather than quietly implying it read everything.
    expect(text).toMatch(/hunks? below the budget/);
  });

  test('a binary file is named as one rather than quoted', () => {
    const diffs = new Map<string, FileDiff | null>([
      ['assets/logo.png', { path: 'assets/logo.png', hunks: [], binary: true }],
    ]);
    const text = prompt([file('assets/logo.png')], diffs);

    expect(text).toContain('assets/logo.png');
    expect(text).toContain('(binary)');
  });

  test('a file whose diff could not be read still appears', () => {
    const diffs = new Map<string, FileDiff | null>([['src/gone.ts', null]]);
    const text = prompt([file('src/gone.ts')], diffs);

    expect(text).toContain('src/gone.ts');
    expect(text).toContain('(diff unavailable)');
  });

  test('a rename says what it was called', () => {
    const diffs = new Map<string, FileDiff | null>([['src/new.ts', { path: 'src/new.ts', hunks: [hunk(1, 2)] }]]);
    const text = prompt([file('src/new.ts', { oldPath: 'src/old.ts' })], diffs);

    expect(text).toContain('renamed from src/old.ts');
  });
});

/**
 * What git history says about the files being changed, which is a different
 * kind of fact from the diff itself: a grouping is a judgement about which
 * parts matter, and a file half the repo moves with is a different thing to
 * touch than one nothing depends on.
 */
describe('buildLensPrompt — what the history says', () => {
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
    // The coupling worth naming is the partner this change leaves out.
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

describe('hunkSpan', () => {
  test('is the new-file lines the hunk covers', () => {
    expect(hunkSpan(hunk(10, 5))).toEqual([10, 14]);
  });

  test('a hunk with nothing in the new file has no span', () => {
    expect(hunkSpan({ header: '@@ -1,2 +0,0 @@', lines: [{ type: 'deletion', content: 'gone', oldLineNo: 1 }] })).toBe(
      null,
    );
  });
});

/**
 * Agents preface answers with banners and apologies however firmly they are
 * asked not to, and the reply is useless if a preamble makes it unparseable.
 */
describe('lens agents', () => {
  const ALL = { claude: true, codex: true };

  /**
   * The three things that make a run answerable, checked on every preset rather
   * than on the two that happen to be here. An agent added later without one of
   * them is an agent that can talk its way out of the task.
   */
  test('every preset is one-shot, isolated from the repo, and held to the schema', () => {
    for (const agent of LENS_AGENTS) {
      const flags = agent.args.join(' ');
      expect(['inline', 'file']).toContain(agent.schemaVia);
      // Nothing of the repository's own configuration loads: no hooks, no
      // plugins, no MCP servers, no instructions file.
      expect(flags).toMatch(/--safe-mode|--ignore-user-config/);
      expect(agent.command).toBeTruthy();
    }
  });

  test('an unknown agent falls back rather than failing to run', () => {
    expect(resolveLensAgent({ agentId: 'nonexistent' }, ALL)?.command).toBe(LENS_AGENTS[0].command);
  });

  test('with no choice made, the first installed agent writes the lens', () => {
    expect(pickLensAgent({ codex: true })?.id).toBe('codex');
    expect(pickLensAgent(ALL)?.id).toBe('claude');
  });

  test('a chosen agent is used even once something earlier in the list appears', () => {
    // The point of storing a choice: installing Claude Code does not silently
    // take the lens back off whoever was asked for.
    expect(resolveLensAgent({ agentId: 'codex' }, ALL)?.id).toBe('codex');
  });

  test('nothing installed and nothing chosen resolves to nothing', () => {
    // Answered here so the failure can say no supported agent is installed,
    // rather than arriving as an ENOENT for whichever binary we assumed.
    expect(resolveLensAgent(null, {})).toBeNull();
    expect(pickLensAgent({})).toBeNull();
  });

  test('the health probe maps onto the agent ids', () => {
    // Pi and opencode are probed for terminals and are not lens agents: neither
    // can be held to a schema.
    expect(installedAgents({ claude: false, codex: true })).toEqual({ claude: false, codex: true });
    expect(installedAgents(null)).toEqual({});
  });
});
