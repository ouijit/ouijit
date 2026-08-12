import { describe, test, expect } from 'vitest';
import { buildLensPrompt, extractJson, hunkSpan } from '../github/lensPrompt';
import { resolveLensAgent, pickLensAgent, installedAgents, LENS_AGENTS } from '../github/lensAgents';
import type { FileDiff } from '../types';
import type { PullRequestDetail, PullRequestFile } from '../github/types';

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

function prompt(files: PullRequestFile[], diffs: Map<string, FileDiff | null>, budget?: number) {
  return buildLensPrompt({ subject, files, diffs, instruction: 'group it by story', budget });
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
describe('extractJson', () => {
  test('takes a bare object', () => {
    expect(extractJson('{"groups":[]}')).toBe('{"groups":[]}');
  });

  test('ignores what is said before and after it', () => {
    const out = 'Sure! Here is the grouping:\n{"groups":[{"title":"A"}]}\nLet me know if you want changes.';
    expect(extractJson(out)).toBe('{"groups":[{"title":"A"}]}');
  });

  test('prefers a fenced block, which is what they mostly emit', () => {
    const out = 'Thinking about {this} first.\n```json\n{"groups":[{"title":"Real"}]}\n```\n';
    expect(extractJson(out)).toBe('{"groups":[{"title":"Real"}]}');
  });

  test('a brace inside a string does not end the object early', () => {
    const out = '{"groups":[{"title":"a } brace","summary":"\\" quote"}]}';
    expect(extractJson(out)).toBe(out);
  });

  test('nothing usable is null rather than a throw', () => {
    expect(extractJson('I could not do that.')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('lens agents', () => {
  const ALL = { claude: true, codex: true, pi: true, opencode: true };

  test('the prompt goes on stdin wherever the agent will read it there', () => {
    // A whole diff on an argv is a diff against the platform's argument limit,
    // so an argument is for the one agent that has no other way in.
    for (const agent of LENS_AGENTS) {
      expect(agent.promptVia).toBe(agent.id === 'opencode' ? 'arg' : 'stdin');
    }
  });

  test('an unknown agent falls back rather than failing to run', () => {
    expect(resolveLensAgent({ agentId: 'nonexistent' }, ALL)?.command).toBe(LENS_AGENTS[0].command);
  });

  test('a custom command replaces the preset, arguments and all', () => {
    const agent = resolveLensAgent({ agentId: 'claude', command: 'my-agent --one-shot --json' }, ALL);
    expect(agent?.command).toBe('my-agent');
    expect(agent?.args).toEqual(['--one-shot', '--json']);
    expect(agent?.promptVia).toBe('stdin');
  });

  test('a blank override leaves the preset alone', () => {
    expect(resolveLensAgent({ agentId: 'codex', command: '   ' }, ALL)?.args).toEqual(['exec', '-']);
  });

  test('a custom command runs even when nothing recognised is installed', () => {
    // It names a binary this app has never heard of; refusing it because none
    // of the four are here would defeat the point of the field.
    expect(resolveLensAgent({ agentId: null, command: 'my-agent' }, {})?.command).toBe('my-agent');
  });

  test('with no choice made, the first installed agent writes the lens', () => {
    expect(pickLensAgent({ codex: true, pi: true })?.id).toBe('codex');
    expect(pickLensAgent({ opencode: true })?.id).toBe('opencode');
    expect(resolveLensAgent(null, { pi: true })?.id).toBe('pi');
  });

  test('a chosen agent is used even once something earlier in the list appears', () => {
    // The point of storing a choice: installing Claude Code does not silently
    // take the lens back off whoever was asked for.
    expect(resolveLensAgent({ agentId: 'opencode' }, ALL)?.id).toBe('opencode');
  });

  test('nothing installed and nothing chosen resolves to nothing', () => {
    // Answered here so the failure can name the four agents, rather than
    // arriving as an ENOENT for whichever binary we assumed.
    expect(resolveLensAgent(null, {})).toBeNull();
    expect(pickLensAgent({})).toBeNull();
  });

  test('the health probe maps onto the agent ids', () => {
    expect(installedAgents({ claude: false, codex: true, pi: false, opencode: true })).toEqual({
      claude: false,
      codex: true,
      pi: false,
      opencode: true,
    });
    expect(installedAgents(null)).toEqual({});
  });
});
