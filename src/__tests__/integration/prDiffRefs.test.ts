/**
 * The two things a PR diff depends on git for: that our ref names can coexist,
 * and that a renamed file diffs as a rename.
 *
 * Both failed silently. The head ref sat where the base ref's parent directory
 * had to go, so pinning the base always failed and `pinRef` swallowed it; and a
 * per-file diff given only the new path reported a rename as a whole-file add.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { getRangeFileDiff } from '../../git';
import { prHeadRef, prBaseRef } from '../../github/prDiff';

let tmpDir: string;
let repoDir: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-pr-diff-'));
  repoDir = path.join(tmpDir, 'project');
  await fs.mkdir(repoDir, { recursive: true });

  git('init');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('pull request refs', () => {
  test('the head and base refs can both exist at once', () => {
    git('commit', '--allow-empty', '-m', 'base');
    const sha = git('rev-parse', 'HEAD');

    // Git's ref store is a filesystem: a ref at refs/ouijit/pr/12 is a file,
    // and nothing can then be created beneath it.
    git('update-ref', prHeadRef(12), sha);
    expect(() => git('update-ref', prBaseRef(12), sha)).not.toThrow();

    expect(git('rev-parse', prHeadRef(12))).toBe(sha);
    expect(git('rev-parse', prBaseRef(12))).toBe(sha);
  });
});

describe('a renamed file', () => {
  test('diffs as a rename with only the lines that changed', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    await fs.writeFile(path.join(repoDir, 'old.txt'), `${lines.join('\n')}\n`);
    git('add', '-A');
    git('commit', '-m', 'base');
    const baseSha = git('rev-parse', 'HEAD');

    git('mv', 'old.txt', 'new.txt');
    lines[5] = 'line 5 changed';
    await fs.writeFile(path.join(repoDir, 'new.txt'), `${lines.join('\n')}\n`);
    git('add', '-A');
    git('commit', '-m', 'rename and edit');
    const headSha = git('rev-parse', 'HEAD');

    const withOldPath = await getRangeFileDiff(repoDir, baseSha, headSha, 'new.txt', undefined, 'old.txt');
    const changed = (withOldPath?.hunks ?? []).flatMap((h) => h.lines).filter((l) => l.type !== 'context');
    expect(changed.map((l) => l.content)).toEqual(['line 5', 'line 5 changed']);

    // Without the old path git cannot pair the two sides, and the file reads as
    // forty new lines — which is what this looked like before.
    const withoutOldPath = await getRangeFileDiff(repoDir, baseSha, headSha, 'new.txt');
    const asAdded = (withoutOldPath?.hunks ?? []).flatMap((h) => h.lines);
    expect(asAdded).toHaveLength(40);
    expect(asAdded.every((l) => l.type === 'addition')).toBe(true);
  });
});
