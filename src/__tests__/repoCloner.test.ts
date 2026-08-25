import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cloneRepository } from '../repoCloner';
import { cloneAndRegisterProject } from '../services/projectRegistration';
import { getDefaultProjectsDir } from '../projectsFolder';
import { getAllProjects, getGlobalSetting } from '../db';
import { ONBOARDING_STATE_KEY } from '../onboardingState';

const execFileAsync = promisify(execFile);

let scratchDir: string;
let originalPath: string | undefined;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-cloner-test-'));
  originalPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await fs.rm(scratchDir, { recursive: true, force: true });
});

/**
 * A `gh` on PATH that clones from a local repo instead of the network, so the
 * real argument construction and failure handling are what gets exercised.
 * `exit 1` when `source` is absent, standing in for a clone that fails.
 */
async function fakeGh(source: string | null): Promise<void> {
  const binDir = path.join(scratchDir, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'gh'),
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "gh version 2.60.0 (2025-01-01)"; exit 0; fi',
      source
        ? `if [ "$1" = "repo" ] && [ "$2" = "clone" ]; then exec git clone --quiet "${source}" "$4"; fi`
        : 'echo "gh: Could not resolve to a Repository (HTTP 404)" >&2',
      'exit 1',
    ].join('\n'),
    { mode: 0o755 },
  );
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
}

/** A repo with one commit, standing in for the GitHub repo being cloned. */
async function sourceRepo(): Promise<string> {
  const repoPath = path.join(scratchDir, 'source');
  await fs.mkdir(repoPath);
  await execFileAsync('git', ['init'], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, 'README.md'), '# source\n');
  await execFileAsync('git', ['add', '-A'], { cwd: repoPath });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Initial commit'],
    { cwd: repoPath },
  );
  return repoPath;
}

describe('cloneRepository', () => {
  test('refuses input that is not a repository', async () => {
    const result = await cloneRepository({ repo: 'nonsense', parentDir: scratchDir });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/owner\/name/);
  });

  test('refuses a name that would escape the location', async () => {
    const result = await cloneRepository({ repo: 'git@github.com:owner/..', parentDir: scratchDir });
    expect(result).toEqual({ success: false, error: 'Invalid repository name' });
  });

  test('refuses a relative location', async () => {
    const result = await cloneRepository({ repo: 'pbjer/ouijit', parentDir: 'relative/projects' });
    expect(result).toEqual({ success: false, error: 'The project location must be an absolute path' });
  });

  test('refuses to clone over an existing folder', async () => {
    await fs.mkdir(path.join(scratchDir, 'ouijit'));
    const result = await cloneRepository({ repo: 'pbjer/ouijit', parentDir: scratchDir });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/);
  });

  test('leaves nothing behind when the clone fails', async () => {
    await fakeGh(null);
    const parentDir = path.join(scratchDir, 'projects');

    const result = await cloneRepository({ repo: 'pbjer/missing', parentDir });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pbjer\/missing was not found/);
    await expect(fs.access(path.join(parentDir, 'missing'))).rejects.toThrow();
  });
});

describe('cloneAndRegisterProject', () => {
  test('clones into the location, registers it, and makes it the default folder', async () => {
    await fakeGh(await sourceRepo());
    const parentDir = path.join(scratchDir, 'projects');

    const result = await cloneAndRegisterProject({ repo: 'https://github.com/pbjer/ouijit', parentDir });

    const projectPath = path.join(parentDir, 'ouijit');
    expect(result).toEqual({ success: true, projectPath });
    await expect(fs.access(path.join(projectPath, 'README.md'))).resolves.toBeUndefined();
    expect((await getAllProjects()).map((p) => p.path)).toContain(projectPath);
    expect(await getDefaultProjectsDir()).toBe(parentDir);
    expect(JSON.parse((await getGlobalSetting(ONBOARDING_STATE_KEY))!)).toMatchObject({
      firstProjectPath: projectPath,
      source: 'cloned',
    });
  });

  test('registers nothing when the clone fails', async () => {
    await fakeGh(null);

    const result = await cloneAndRegisterProject({ repo: 'pbjer/missing', parentDir: scratchDir });

    expect(result.success).toBe(false);
    expect(await getAllProjects()).toEqual([]);
  });
});
