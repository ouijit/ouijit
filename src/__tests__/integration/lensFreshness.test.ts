/**
 * Whether a lens still describes the diff, against a real repository.
 *
 * The pin is the whole of it, and until now nothing ran it against real refs —
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
import { _resetCacheForTesting } from '../../db';
import { invalidateMainBranchCache } from '../../git';
import { saveLens } from '../../lens/config';
import { readDiffLens, writeDiffLens, type DiffLensTarget } from '../../lens/worktreeSubject';

const GROUPS = vi.hoisted(() => JSON.stringify({ groups: [{ title: 'Transport', slices: [{ path: 'a.ts' }] }] }));

vi.mock('../../lens/runLens', () => ({ runLens: vi.fn(async () => ({ success: true, body: GROUPS })) }));
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
