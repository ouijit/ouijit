/**
 * A lens over a real repository: written, gone stale, interrupted, collected.
 *
 * The pin is most of it, and until now nothing ran it against real refs —
 * `readLens.test.ts` hands the reader a fake subject, which is how a pin that
 * ignored the working tree survived a suite that covers lenses nine files deep.
 *
 * Two boundaries are stubbed and no more: the agent, which is a spawned CLI,
 * and the health check, which asks the machine what is installed. Everything
 * between them is the real thing over a real git repository.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { _resetCacheForTesting, deleteWorktreeDiffLenses } from '../../db';
import { invalidateMainBranchCache } from '../../git';
import { saveLens } from '../../lens/config';
import { readDiffLens, writeDiffLens, type DiffLensTarget } from '../../lens/worktreeSubject';

const GROUPS = vi.hoisted(() => JSON.stringify({ groups: [{ title: 'Transport', slices: [{ path: 'a.ts' }] }] }));

/** The agent, which is a spawned CLI: what it answers, and how long it takes. */
const agent = vi.hoisted(() => ({
  answer: async (): Promise<{ success: boolean; body?: string; error?: string }> => ({ success: true, body: GROUPS }),
}));
vi.mock('../../lens/runLens', () => ({ runLens: () => agent.answer() }));
vi.mock('../../healthCheck', () => {
  const health = { claude: true, codex: false };
  return { getCachedHealth: () => health, checkHealth: async () => health };
});

let repo: string;
let lensId: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

async function write(file: string, contents: string): Promise<void> {
  await fs.writeFile(path.join(repo, file), contents);
}

function target(): DiffLensTarget {
  return { projectPath: repo, worktreePath: repo, base: 'main', branch: 'feature' };
}

/** Write the lens over whatever the diff is now, and confirm it starts fresh. */
async function readThroughLens(): Promise<void> {
  expect(await writeDiffLens(target(), lensId)).toEqual({ success: true });
  expect((await readDiffLens(target()))?.stale).toBe(false);
}

beforeEach(async () => {
  agent.answer = async () => ({ success: true, body: GROUPS });
  _resetCacheForTesting();
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-lens-freshness-'));
  invalidateMainBranchCache(repo);

  git('init', '-b', 'main');
  git('config', 'user.email', 'test@x');
  git('config', 'user.name', 'Test');
  await write('a.ts', 'export const one = 1;\n');
  git('add', '-A');
  git('commit', '-m', 'first');

  git('checkout', '-b', 'feature');
  await write('a.ts', 'export const one = 1;\nexport const two = 2;\n');
  git('commit', '-am', 'second');

  lensId = (await saveLens(repo, { name: 'Narrative', instruction: 'group by story' })).id;
});

describe('whether a lens still describes the diff', () => {
  /**
   * The panel takes its diff with `--merge-base`, which runs through to
   * uncommitted edits — so a pin of committed revisions alone reports fresh
   * while the reader is typing under a grouping that no longer fits.
   */
  test('the change moving makes it stale, whether it was committed or not', async () => {
    await readThroughLens();

    await write('a.ts', 'export const one = 1;\nexport const two = 2;\nexport const three = 3;\n');
    expect((await readDiffLens(target()))?.stale).toBe(true);

    // And committing that edit is still the change moving, not a return to what
    // the lens was written over.
    await readThroughLens();
    await write('a.ts', 'export const one = 1;\nexport const two = 2;\nexport const four = 4;\n');
    git('commit', '-am', 'third');
    expect((await readDiffLens(target()))?.stale).toBe(true);
  });

  /**
   * Both the diff and the pin read `merge-base(main, feature)`, which a commit
   * landing elsewhere on main does not move. Nothing the reader is looking at
   * changed, so nothing should say it did — and pinning this stops a later
   * change to how the diff is taken from breaking the model quietly.
   */
  test('the base advancing is not the change moving', async () => {
    await readThroughLens();

    git('checkout', 'main');
    await write('b.ts', 'export const elsewhere = true;\n');
    git('add', '-A');
    git('commit', '-m', 'unrelated');
    git('checkout', 'feature');

    const lens = await readDiffLens(target());
    expect(lens?.stale).toBe(false);
    expect(lens?.groups?.map((group) => group.title)).toEqual(['Transport']);
  });
});

/**
 * Nothing was written until the agent answered, so a quit or a crash mid-run
 * was indistinguishable from never having asked — and the only record that one
 * was going lived in renderer memory, which a reload throws away.
 */
describe('a run that has not answered yet', () => {
  test('is on the row while it runs, and gone once it is', async () => {
    let answer = (): void => {};
    let asked = (): void => {};
    const spawned = new Promise<void>((resolve) => {
      asked = resolve;
    });
    agent.answer = () =>
      new Promise((resolve) => {
        answer = () => resolve({ success: true, body: GROUPS });
        asked();
      });

    const run = writeDiffLens(target(), lensId);
    await spawned;

    // Live, because this is the process that started it. The same mark found by
    // a process that did not start it is an interrupted run.
    const running = (await readDiffLens(target()))?.running;
    expect(running?.lensName).toBe('Narrative');
    expect(running?.live).toBe(true);

    answer();
    await run;
    expect((await readDiffLens(target()))?.running).toBeNull();
  });

  test('a failed run leaves the grouping that was already there', async () => {
    await readThroughLens();

    agent.answer = async () => ({ success: false, error: 'claude is not on PATH' });
    expect(await writeDiffLens(target(), lensId)).toEqual({ success: false, error: 'claude is not on PATH' });

    // Recorded beside the groups rather than over them, so the run that failed
    // costs the reader nothing they already had.
    const lens = await readDiffLens(target());
    expect(lens?.running).toBeNull();
    expect(lens?.groups?.map((group) => group.title)).toEqual(['Transport']);
    expect(lens?.stale).toBe(false);
  });
});

describe('housekeeping', () => {
  test('a worktree pins its own HEAD, even detached', async () => {
    const tree = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-lens-detached-'));
    const worktree = path.join(tree, 'detached');
    git('worktree', 'add', '--detach', worktree, 'feature');
    const detached: DiffLensTarget = {
      projectPath: repo,
      worktreePath: worktree,
      base: 'main',
      // What `rev-parse --abbrev-ref HEAD` answers with no branch checked out.
      branch: 'HEAD',
    };

    expect(await writeDiffLens(detached, lensId)).toEqual({ success: true });
    expect((await readDiffLens(detached))?.stale).toBe(false);

    // The project checkout moves on. Pinned there rather than in the worktree,
    // a detached worktree reads someone else's HEAD and goes stale for it.
    git('checkout', 'main');
    await write('c.ts', 'export const other = true;\n');
    git('add', '-A');
    git('commit', '-m', 'in the project checkout');

    expect((await readDiffLens(detached))?.stale).toBe(false);
  });

  test('removing a worktree takes its lenses with it, and only its own', async () => {
    await readThroughLens();

    const tree = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-lens-other-'));
    const other = path.join(tree, 'other');
    git('worktree', 'add', '--detach', other, 'feature');
    const elsewhere: DiffLensTarget = { ...target(), worktreePath: other, branch: 'HEAD' };
    expect(await writeDiffLens(elsewhere, lensId)).toEqual({ success: true });

    // The path is handed out again the next time the task is started, and a
    // worktree lens renders when it has drifted rather than dropping — so a row
    // left behind would be drawn over a change it was never written for.
    await deleteWorktreeDiffLenses(repo, repo);

    expect(await readDiffLens(target())).toBeNull();
    expect((await readDiffLens(elsewhere))?.groups).not.toBeNull();
  });
});
