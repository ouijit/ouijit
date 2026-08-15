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
import { prHeadRef, prBaseRef, ensurePrRefs, prunePrRefs } from '../../github/prDiff';

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

  /**
   * Being present in the object store is not the same as being reachable. A PR
   * head can already be there from a since-deleted branch or an old FETCH_HEAD,
   * and pinning only what this call had to fetch left exactly those commits
   * prunable — the diff then failed after a `git gc` the user did not connect
   * to it.
   */
  test('pins both commits even when neither had to be fetched', async () => {
    git('commit', '--allow-empty', '-m', 'base');
    const trunk = git('rev-parse', '--abbrev-ref', 'HEAD');
    const baseSha = git('rev-parse', 'HEAD');

    git('checkout', '-b', 'theirs');
    git('commit', '--allow-empty', '-m', 'their change');
    const headSha = git('rev-parse', 'HEAD');
    git('checkout', trunk);
    git('branch', '-D', 'theirs');

    // Present, but nothing durable reaches it. No remote is configured, so a
    // fetch here would fail rather than quietly cover for a missing pin.
    expect(git('rev-parse', `${headSha}^{commit}`)).toBe(headSha);

    const result = await ensurePrRefs(repoDir, 9, baseSha, headSha, 'origin');
    expect(result.success).toBe(true);
    expect(git('rev-parse', prHeadRef(9))).toBe(headSha);
    expect(git('rev-parse', prBaseRef(9))).toBe(baseSha);

    git('reflog', 'expire', '--expire=now', '--all');
    git('prune', '--expire=now');
    expect(git('rev-parse', `${headSha}^{commit}`)).toBe(headSha);
    // A dozen git subprocesses; the default 5s is not enough under a loaded
    // suite even though it takes a fraction of that on its own.
  }, 20_000);
});

describe('concurrent diff loads', () => {
  /**
   * The files view loads ten diffs at once and each needs the refs, so on a
   * PR's first open all ten used to start the same `git fetch` — ten network
   * round trips for one ref, three hundred on a large PR. Concurrent fetches
   * of the same refspec do all succeed, so this was never visible; it was just
   * the same work repeated. The answer is kept once it settles, so the second
   * batch of ten does not repeat the check either.
   */
  test('fetch the pull request refs once, not once per file', async () => {
    git('commit', '--allow-empty', '-m', 'base');
    const baseSha = git('rev-parse', 'HEAD');

    // A bare "remote" exposing a PR head the project does not have yet, the way
    // GitHub exposes refs/pull/<n>/head.
    const remoteDir = path.join(tmpDir, 'remote.git');
    const workDir = path.join(tmpDir, 'contributor');
    execFileSync('git', ['clone', '--bare', repoDir, remoteDir], { encoding: 'utf8' });
    execFileSync('git', ['clone', remoteDir, workDir], { encoding: 'utf8' });
    const inWork = (...args: string[]) => execFileSync('git', args, { cwd: workDir, encoding: 'utf8' }).trim();
    inWork('config', 'user.email', 'them@test.com');
    inWork('config', 'user.name', 'Them');
    inWork('commit', '--allow-empty', '-m', 'their change');
    inWork('push', 'origin', 'HEAD:refs/pull/7/head');
    const headSha = inWork('rev-parse', 'HEAD');

    git('remote', 'add', 'origin', remoteDir);
    expect(headSha).not.toBe(baseSha);

    // Ten at once, exactly as the batched file loader issues them. They share
    // one promise, which is the same thing as sharing one fetch.
    const calls = Array.from({ length: 10 }, () => ensurePrRefs(repoDir, 7, baseSha, headSha, 'origin'));
    expect(new Set(calls).size).toBe(1);

    const results = await Promise.all(calls);
    expect(results.filter((r) => !r.success)).toEqual([]);
    expect(git('rev-parse', prHeadRef(7))).toBe(headSha);

    // And a later batch is served the settled answer rather than redoing the
    // whole ref check. Success is not a thing that stops being true: the SHAs
    // are in the object store and pinned under refs we own.
    expect(ensurePrRefs(repoDir, 7, baseSha, headSha, 'origin')).toBe(calls[0]);

    // Until the refs are dropped, at which point it is asked again.
    await prunePrRefs(repoDir, 7);
    expect(ensurePrRefs(repoDir, 7, baseSha, headSha, 'origin')).not.toBe(calls[0]);
    // Three clones and a fetch; the default 5s is not enough under a loaded
    // suite even though it takes a fraction of that on its own.
  }, 20_000);
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
