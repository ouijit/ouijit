import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCloneProgress, resolveCloneTarget, runClone } from '../repoCloner';
import { startClone, listCloneJobs, setCloneListeners } from '../services/cloneRegistry';
import { getDefaultProjectsDir } from '../projectsFolder';
import { getAllProjects, getGlobalSetting } from '../db';
import { ONBOARDING_STATE_KEY } from '../onboardingState';
import type { CloneJob, CloneProgress } from '../types';

const execFileAsync = promisify(execFile);

let scratchDir: string;
let originalPath: string | undefined;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-cloner-test-'));
  originalPath = process.env.PATH;
  setCloneListeners({ onChanged: () => {}, onLanded: () => {} });
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await fs.rm(scratchDir, { recursive: true, force: true });
});

/**
 * A `gh` on PATH that clones from a local repo rather than the network, so the
 * real argument construction, streaming and cleanup are what get exercised.
 */
async function fakeGh(behaviour: { source?: string; stall?: boolean } = {}): Promise<void> {
  const binDir = path.join(scratchDir, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  const clone = behaviour.stall
    ? ['  echo "Receiving objects:  10% (1/10)" >&2', '  sleep 30', '  exit 0']
    : behaviour.source
      ? [
          String.raw`  printf 'remote: Enumerating objects: 3, done.\nReceiving objects:  50%% (1/2)\rReceiving objects: 100%% (2/2), done.\n' >&2`,
          `  exec git clone --quiet "${behaviour.source}" "$4"`,
        ]
      : ['  echo "remote: Repository not found." >&2', '  exit 128'];

  await fs.writeFile(
    path.join(binDir, 'gh'),
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "gh version 2.60.0 (2025-01-01)"; exit 0; fi',
      'if [ "$1" = "repo" ] && [ "$2" = "clone" ]; then',
      ...clone,
      'fi',
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

async function target(parentDir: string, repo = 'pbjer/ouijit') {
  const resolved = await resolveCloneTarget({ repo, parentDir });
  if (resolved.ok === false) throw new Error(resolved.error);
  return resolved.target;
}

/** These fork `gh` and `git` several times; the default 5s is not a real budget. */
const SUBPROCESS_TIMEOUT = 30_000;

const exists = (p: string) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

describe('parseCloneProgress', () => {
  test.each<[string, CloneProgress]>([
    [
      'Receiving objects:  43% (55209/128394), 178.22 MiB | 11.40 MiB/s',
      { phase: 'Receiving objects', percent: 43, detail: '178.22 MiB | 11.40 MiB/s' },
    ],
    ['Receiving objects: 100% (13/13), done.', { phase: 'Receiving objects', percent: 100, detail: null }],
    ['remote: Counting objects:  57% (4/7)', { phase: 'Counting objects', percent: 57, detail: null }],
    ['Resolving deltas:  81% (74122/91455)', { phase: 'Resolving deltas', percent: 81, detail: null }],
    ['Updating files:  62% (8801/14093)', { phase: 'Updating files', percent: 62, detail: null }],
    ['remote: Enumerating objects: 128394, done.', { phase: 'Enumerating objects', percent: null, detail: null }],
  ])('reads %s', (line, expected) => {
    expect(parseCloneProgress(line)).toEqual(expected);
  });

  test.each([
    "Cloning into 'hw'...",
    'remote: Total 13 (delta 0), reused 0 (delta 0), pack-reused 13 (from 1)',
    'fatal: repository not found',
    '',
  ])('ignores %j, which carries no progress', (line) => {
    expect(parseCloneProgress(line)).toBeNull();
  });
});

describe('resolveCloneTarget', () => {
  test('stages the clone beside where it will land, so the rename cannot cross a filesystem', async () => {
    const resolved = await resolveCloneTarget({ repo: 'pbjer/ouijit', parentDir: scratchDir });

    expect(resolved).toEqual({
      ok: true,
      target: {
        identity: { host: 'github.com', owner: 'pbjer', repo: 'ouijit' },
        projectPath: path.join(scratchDir, 'ouijit'),
        stagingPath: path.join(scratchDir, '.ouijit.cloning'),
      },
    });
  });

  test.each([
    ['nonsense', /owner\/name/],
    ['git@github.com:owner/..', /Invalid repository name/],
  ])('refuses %s', async (repo, message) => {
    const resolved = await resolveCloneTarget({ repo, parentDir: scratchDir });
    expect(resolved).toMatchObject({ ok: false, error: expect.stringMatching(message) });
  });

  test('refuses a relative location', async () => {
    expect(await resolveCloneTarget({ repo: 'pbjer/ouijit', parentDir: 'relative/projects' })).toEqual({
      ok: false,
      error: 'The project location must be an absolute path',
    });
  });

  test('refuses to clone over an existing folder', async () => {
    await fs.mkdir(path.join(scratchDir, 'ouijit'));
    expect(await resolveCloneTarget({ repo: 'pbjer/ouijit', parentDir: scratchDir })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already exists/),
    });
  });
});

describe('runClone', () => {
  test(
    'reports progress and renames the staging directory into place',
    async () => {
      await fakeGh({ source: await sourceRepo() });
      const spot = await target(path.join(scratchDir, 'projects'));
      const seen: CloneProgress[] = [];

      const outcome = await runClone(spot, (progress) => seen.push(progress)).done;

      expect(outcome).toEqual({ status: 'landed' });
      expect(await exists(path.join(spot.projectPath, 'README.md'))).toBe(true);
      expect(await exists(spot.stagingPath)).toBe(false);
      expect(seen.some((p) => p.phase === 'Receiving objects')).toBe(true);
    },
    SUBPROCESS_TIMEOUT,
  );

  test(
    'leaves neither the destination nor the staging directory behind on failure',
    async () => {
      await fakeGh();
      const spot = await target(path.join(scratchDir, 'projects'), 'pbjer/missing');

      const outcome = await runClone(spot, () => {}).done;

      expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/was not found/) });
      expect(await exists(spot.projectPath)).toBe(false);
      expect(await exists(spot.stagingPath)).toBe(false);
    },
    SUBPROCESS_TIMEOUT,
  );

  test(
    'cancelling a running clone stops it and drops what it had written',
    async () => {
      await fakeGh({ stall: true });
      const spot = await target(path.join(scratchDir, 'projects'));
      let running: () => void;
      const started = new Promise<void>((resolve) => (running = resolve));

      const clone = runClone(spot, () => running());
      await started;
      clone.cancel();

      expect(await clone.done).toEqual({ status: 'canceled' });
      expect(await exists(spot.projectPath)).toBe(false);
      expect(await exists(spot.stagingPath)).toBe(false);
    },
    SUBPROCESS_TIMEOUT,
  );

  test(
    'clears a staging directory an earlier run was killed before removing',
    async () => {
      await fakeGh({ source: await sourceRepo() });
      const spot = await target(path.join(scratchDir, 'projects'));
      await fs.mkdir(spot.stagingPath, { recursive: true });
      await fs.writeFile(path.join(spot.stagingPath, 'leftover'), 'from a killed run');

      expect(await runClone(spot, () => {}).done).toEqual({ status: 'landed' });
      expect(await exists(path.join(spot.projectPath, 'leftover'))).toBe(false);
    },
    SUBPROCESS_TIMEOUT,
  );
});

describe('clone registry', () => {
  /** Resolves once the registry stops reporting the job as in flight. */
  function settled(projectPath: string): Promise<CloneJob[]> {
    return new Promise((resolve) => {
      setCloneListeners({
        onChanged: (jobs) => {
          const job = jobs.find((entry) => entry.projectPath === projectPath);
          if (!job || job.status === 'failed') resolve(jobs);
        },
        onLanded: () => {},
      });
    });
  }

  test(
    'registers the project once the clone lands, and stops tracking it',
    async () => {
      await fakeGh({ source: await sourceRepo() });
      const parentDir = path.join(scratchDir, 'projects');
      const projectPath = path.join(parentDir, 'ouijit');
      const done = settled(projectPath);

      const started = await startClone({ repo: 'https://github.com/pbjer/ouijit', parentDir });
      expect(started).toEqual({ success: true, projectPath });
      // Visible immediately: the caller navigates to it before anything downloads.
      expect(listCloneJobs()).toMatchObject([{ projectPath, slug: 'pbjer/ouijit', status: 'cloning' }]);

      await done;
      expect(listCloneJobs()).toEqual([]);
      expect((await getAllProjects()).map((p) => p.path)).toContain(projectPath);
      expect(await getDefaultProjectsDir()).toBe(parentDir);
      expect(JSON.parse((await getGlobalSetting(ONBOARDING_STATE_KEY))!)).toMatchObject({ source: 'cloned' });
    },
    SUBPROCESS_TIMEOUT,
  );

  test(
    'keeps a failed clone visible, with git output, and registers nothing',
    async () => {
      await fakeGh();
      const parentDir = path.join(scratchDir, 'projects');
      const done = settled(path.join(parentDir, 'missing'));

      await startClone({ repo: 'pbjer/missing', parentDir });

      await done;
      expect(listCloneJobs()).toMatchObject([
        { status: 'failed', error: expect.stringMatching(/was not found/), output: expect.stringContaining('remote:') },
      ]);
      expect(await getAllProjects()).toEqual([]);
    },
    SUBPROCESS_TIMEOUT,
  );

  test(
    'refuses a second clone of a destination already in flight',
    async () => {
      await fakeGh({ stall: true });
      const parentDir = path.join(scratchDir, 'projects');

      await startClone({ repo: 'pbjer/ouijit', parentDir });
      const second = await startClone({ repo: 'pbjer/ouijit', parentDir });

      expect(second).toMatchObject({ success: false, error: expect.stringMatching(/already being cloned/) });
    },
    SUBPROCESS_TIMEOUT,
  );
});
