import { describe, test, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateProjectFolder } from '../projectCreator';

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-validate-'));
});

describe('validateProjectFolder', () => {
  test('rejects a folder that is not a git repository', async () => {
    const folder = path.join(scratchDir, 'plain-folder');
    await fs.mkdir(folder);

    const result = await validateProjectFolder(folder);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a git repository/i);
  });

  test('accepts a folder containing a .git directory', async () => {
    const folder = path.join(scratchDir, 'real-repo');
    await fs.mkdir(folder);
    await fs.mkdir(path.join(folder, '.git'));

    const result = await validateProjectFolder(folder);

    expect(result.ok).toBe(true);
  });

  test('accepts a worktree folder where .git is a file', async () => {
    const folder = path.join(scratchDir, 'worktree');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, '.git'), 'gitdir: /some/path\n');

    const result = await validateProjectFolder(folder);

    expect(result.ok).toBe(true);
  });

  test('rejects a non-existent path', async () => {
    const folder = path.join(scratchDir, 'does-not-exist');
    const result = await validateProjectFolder(folder);
    expect(result.ok).toBe(false);
  });

  test('rejects a path that is a file, not a directory', async () => {
    const file = path.join(scratchDir, 'a-file');
    await fs.writeFile(file, 'hi');
    const result = await validateProjectFolder(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a directory/i);
  });
});
