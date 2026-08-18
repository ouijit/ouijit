/**
 * Binary files in a range diff, against a real git repo.
 *
 * Git reports an image change as "Binary files … differ" and no hunks, which is
 * indistinguishable from an empty diff unless the flag survives — so this walks
 * the whole path a PR image viewer depends on: the flag, both blobs, the
 * missing side of an added file, and the size cap.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { getRangeFileDiff, readBlob } from '../../git';

/** A valid 1x1 PNG — real image bytes, so git and an <img> both accept it. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let tmpDir: string;
let repoDir: string;
let baseSha: string;
let headSha: string;

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: repoDir, encoding: 'utf8' }).trim();
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-binary-diff-'));
  repoDir = path.join(tmpDir, 'project');
  await fs.mkdir(repoDir, { recursive: true });

  git('init');
  git('config user.email "test@test.com"');
  git('config user.name "Test"');

  const png = Buffer.from(PNG_BASE64, 'base64');
  await fs.writeFile(path.join(repoDir, 'logo.png'), png);
  await fs.writeFile(path.join(repoDir, 'notes.txt'), 'before\n');
  git('add -A');
  git('commit -m "base"');
  baseSha = git('rev-parse HEAD');

  // Changed image, new image, changed text — one commit covering every case.
  await fs.writeFile(path.join(repoDir, 'logo.png'), Buffer.concat([png, Buffer.from([0, 1, 2, 3])]));
  await fs.writeFile(path.join(repoDir, 'icon.png'), png);
  await fs.writeFile(path.join(repoDir, 'notes.txt'), 'after\n');
  git('add -A');
  git('commit -m "head"');
  headSha = git('rev-parse HEAD');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('binary files in a range diff', () => {
  test('are flagged as binary while text files are not', async () => {
    const image = await getRangeFileDiff(repoDir, baseSha, headSha, 'logo.png');
    expect(image?.binary).toBe(true);
    expect(image?.hunks).toEqual([]);

    const added = await getRangeFileDiff(repoDir, baseSha, headSha, 'icon.png');
    expect(added?.binary).toBe(true);

    const text = await getRangeFileDiff(repoDir, baseSha, headSha, 'notes.txt');
    expect(text?.binary).toBe(false);
    expect(text?.hunks.length).toBe(1);
  });

  test('readBlob returns each side, nothing for a side that does not exist, and size only past the cap', async () => {
    const png = Buffer.from(PNG_BASE64, 'base64');

    const before = await readBlob(repoDir, baseSha, 'logo.png', 1024 * 1024);
    expect(before?.byteSize).toBe(png.length);
    expect(before?.base64).toBe(PNG_BASE64);

    const after = await readBlob(repoDir, headSha, 'logo.png', 1024 * 1024);
    expect(after?.byteSize).toBe(png.length + 4);
    expect(Buffer.from(after!.base64!, 'base64').subarray(0, png.length)).toEqual(png);

    // The base side of a file the change adds.
    expect(await readBlob(repoDir, baseSha, 'icon.png', 1024 * 1024)).toBeNull();

    // Past the cap the size is still reported, so the viewer can say how big it is.
    const capped = await readBlob(repoDir, headSha, 'logo.png', 8);
    expect(capped?.byteSize).toBe(png.length + 4);
    expect(capped?.base64).toBeUndefined();
  });
});
