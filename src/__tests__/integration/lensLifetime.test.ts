/**
 * A lens over a real repository: written, gone stale, interrupted, collected.
 * The pin is most of it, and only real refs exercise it — `lensReading` runs the
 * same reader against a stub subject, where the pin can only be told to be wrong.
 *
 * Two boundaries are stubbed and no more: the agent, which is a spawned CLI, and
 * the health check, which asks the machine what is installed. The stub stands in
 * one step further in than the spawn, so that the cases below cost no processes;
 * what it stands in for is pinned against a real one in `runLens.test.ts`.
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
vi.mock('../../healthCheck', () => ({
  currentHealth: async () => ({ claude: true, codex: false }),
}));

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
  test('the change moving makes it stale, whether it was committed or not', async () => {
    await readThroughLens();

    await write('a.ts', 'export const one = 1;\nexport const two = 2;\nexport const three = 3;\n');
    expect((await readDiffLens(target()))?.stale).toBe(true);

    // Committing that edit is still the change moving.
    await readThroughLens();
    await write('a.ts', 'export const one = 1;\nexport const two = 2;\nexport const four = 4;\n');
    git('commit', '-am', 'third');
    expect((await readDiffLens(target()))?.stale).toBe(true);
  });

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
 * A run is recorded before the agent is spawned, so a quit mid-run is told from
 * never having asked.
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

    // Beside the groups rather than over them, so a failed run costs the reader
    // nothing they already had.
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

    // Pinned in the worktree rather than the project checkout: a detached
    // worktree would otherwise read someone else's HEAD and go stale for it.
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
