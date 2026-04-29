import { describe, test, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { addProject, getAllProjects } from '../db';

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-addproject-'));
});

describe('addProject', () => {
  test('rejects a folder that is not a git repository', async () => {
    const folder = path.join(scratchDir, 'plain-folder');
    await fs.mkdir(folder);

    const result = await addProject(folder);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a git repository/i);
    const projects = await getAllProjects();
    expect(projects.find((p) => p.path === folder)).toBeUndefined();
  });

  test('accepts a folder containing a .git directory', async () => {
    const folder = path.join(scratchDir, 'real-repo');
    await fs.mkdir(folder);
    await fs.mkdir(path.join(folder, '.git'));

    const result = await addProject(folder);

    expect(result.success).toBe(true);
    const projects = await getAllProjects();
    expect(projects.find((p) => p.path === folder)).toBeDefined();
  });

  test('accepts a worktree folder where .git is a file', async () => {
    const folder = path.join(scratchDir, 'worktree');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, '.git'), 'gitdir: /some/path\n');

    const result = await addProject(folder);

    expect(result.success).toBe(true);
  });

  test('rejects a non-existent path', async () => {
    const folder = path.join(scratchDir, 'does-not-exist');
    const result = await addProject(folder);
    expect(result.success).toBe(false);
  });
});
