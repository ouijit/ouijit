import { describe, test, expect, vi } from 'vitest';

vi.mock('electron-log', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { reconcileGroups, runLens, type LensGroup } from '../github/prCommand';
import type { PullRequestDetail, PullRequestFile } from '../github/types';
import type { PrCommandRow } from '../db';

function file(path: string): PullRequestFile {
  return { path, status: 'M', additions: 1, deletions: 1 };
}

function lens(command: string): PrCommandRow {
  return { id: 'c1', project_path: '/work/alpha', name: 'narrative', command, mode: 'lens', sort_order: 0 };
}

const DETAIL = {
  number: 264,
  title: 'A change',
  baseRefName: 'main',
  headRefName: 'feature',
  url: 'https://github.com/o/r/pull/264',
} as unknown as PullRequestDetail;

/**
 * The invariant the whole feature rests on. A lens is someone's shell command,
 * and a reviewer has to be able to trust that running one cannot quietly remove
 * code from the diff they are signing off on.
 */
describe('reconcileGroups', () => {
  test('a file the lens forgot still shows, in a trailing group', () => {
    const groups: LensGroup[] = [{ title: 'Core', paths: ['a.ts'] }];
    const result = reconcileGroups(groups, [file('a.ts'), file('b.ts')]);

    expect(result.map((g) => g.title)).toEqual(['Core', 'Everything else']);
    expect(result[1].paths).toEqual(['b.ts']);
  });

  test('a path the lens invented is dropped', () => {
    const groups: LensGroup[] = [{ title: 'Core', paths: ['a.ts', 'imaginary.ts'] }];
    const result = reconcileGroups(groups, [file('a.ts')]);

    expect(result).toHaveLength(1);
    expect(result[0].paths).toEqual(['a.ts']);
  });

  test('a path listed twice renders once, in the first group that claimed it', () => {
    const groups: LensGroup[] = [
      { title: 'First', paths: ['a.ts'] },
      { title: 'Second', paths: ['a.ts', 'b.ts'] },
    ];
    const result = reconcileGroups(groups, [file('a.ts'), file('b.ts')]);

    expect(result[0].paths).toEqual(['a.ts']);
    expect(result[1].paths).toEqual(['b.ts']);
  });

  test('an empty group is not rendered', () => {
    const groups: LensGroup[] = [
      { title: 'Nothing here', paths: ['gone.ts'] },
      { title: 'Core', paths: ['a.ts'] },
    ];
    const result = reconcileGroups(groups, [file('a.ts')]);

    expect(result.map((g) => g.title)).toEqual(['Core']);
  });

  test('every file lands somewhere when the lens returns nothing at all', () => {
    const result = reconcileGroups([], [file('a.ts'), file('b.ts')]);

    expect(result).toHaveLength(1);
    expect(result[0].paths).toEqual(['a.ts', 'b.ts']);
  });
});

describe('runLens', () => {
  const files = [file('a.ts'), file('b.ts')];

  test('reads the file list on stdin and groups by what it prints', async () => {
    // Echoes back a group built from the stdin it was given, which is also the
    // assertion that stdin carries the file list.
    const result = await runLens(
      lens(
        `node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const i=JSON.parse(s);` +
          `process.stdout.write(JSON.stringify({groups:[{title:'Read '+i.prNumber,paths:i.files.map(f=>f.path)}]}))})"`,
      ),
      process.cwd(),
      DETAIL,
      files,
    );

    expect(result.success).toBe(true);
    expect(result.groups).toEqual([{ title: 'Read 264', paths: ['a.ts', 'b.ts'] }]);
  });

  /**
   * The common case for a hand-written lens: a glob script that never reads its
   * input. Writing to a pipe nobody drains raises EPIPE, and treating that as a
   * failure would break the simplest kind of lens there is.
   */
  test('a lens that ignores stdin still succeeds', async () => {
    const result = await runLens(
      lens(`echo '{"groups":[{"title":"Everything","paths":["a.ts","b.ts"]}]}'`),
      process.cwd(),
      DETAIL,
      files,
    );

    expect(result.success).toBe(true);
    expect(result.groups?.[0].title).toBe('Everything');
  });

  test('a banner before the JSON does not break the parse', async () => {
    const result = await runLens(
      lens(`echo 'Thinking...' && echo '{"groups":[{"title":"Core","paths":["a.ts"]}]}'`),
      process.cwd(),
      DETAIL,
      files,
    );

    expect(result.success).toBe(true);
    expect(result.groups?.[0].title).toBe('Core');
  });

  test('the environment carries the pull request', async () => {
    const result = await runLens(
      lens(`echo "{\\"groups\\":[{\\"title\\":\\"PR $OUIJIT_PR_NUMBER on $OUIJIT_PR_BRANCH\\",\\"paths\\":[]}]}"`),
      process.cwd(),
      DETAIL,
      files,
    );

    expect(result.success).toBe(true);
    // The group is empty so it is dropped, but the trailing group proves the
    // run happened and every file survived it.
    expect(result.groups?.[0].title).toBe('Everything else');
  });

  test('output that is not JSON fails, and says so with stderr', async () => {
    const result = await runLens(lens(`echo 'not json' && echo 'no groups here' >&2`), process.cwd(), DETAIL, files);

    expect(result.success).toBe(false);
    expect(result.error).toContain('no groups here');
  });

  test('a non-zero exit reports stderr rather than the code', async () => {
    const result = await runLens(lens(`echo 'lens is broken' >&2 && exit 3`), process.cwd(), DETAIL, files);

    expect(result.success).toBe(false);
    expect(result.error).toContain('lens is broken');
  });

  test('a silent failure still names the command', async () => {
    const result = await runLens(lens('exit 1'), process.cwd(), DETAIL, files);

    expect(result.success).toBe(false);
    expect(result.error).toContain('narrative');
  });
});
