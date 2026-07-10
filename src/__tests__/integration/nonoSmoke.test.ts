/**
 * Smoke test that launches the vendored nono binary with the argv Ouijit
 * really generates. Unit tests pin the argv shape; only a real launch catches
 * the binary rejecting it — nono 0.66 broke two releases that way (strict
 * pack verification, file-vs-directory grant flags).
 *
 * Skips when the vendored binary is absent (postinstall download not run) or
 * the platform can't enforce the sandbox. Everything else is hermetic: a
 * temp XDG config root gets the union profile + bundled packs, and the
 * sandboxed task is a real linked worktree, matching production.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildNonoLaunch } from '../../sandbox/nono/argv';
import { installUnionProfile } from '../../sandbox/nono/profile';
import { getVendoredNonoPath, getMainGitDir, checkPlatformSupport } from '../../sandbox/nono/binary';
import { setDevResourcesRoot } from '../../paths';

const execFileAsync = promisify(execFile);

// Point bundled-resource resolution at the repo's resources/ dir, as main.ts
// does for dev runs; without it the vendored binary and packs are invisible.
setDevResourcesRoot(fileURLToPath(new URL('../../../resources', import.meta.url)));

const nonoPath = getVendoredNonoPath();
const platform = checkPlatformSupport();

let tmpDir: string;
let worktreeDir: string;
let repoDir: string;
let savedXdgConfigHome: string | undefined;

describe.skipIf(nonoPath === null || !platform.supported)('nono end-to-end smoke', () => {
  beforeAll(async () => {
    // realpath: git reports resolved paths, and on macOS os.tmpdir() is a
    // /var → /private/var symlink.
    tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-nono-smoke-')));

    // Hermetic nono config root: the union profile and bundled agent packs
    // install here, exercising the same first-spawn path as a fresh machine.
    // The env var must be set process-wide because installUnionProfile
    // resolves the root itself.
    savedXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'config');
    await installUnionProfile(nonoPath!);

    // A main repo plus a linked worktree, like a started task.
    repoDir = path.join(tmpDir, 'project');
    await fs.mkdir(repoDir, { recursive: true });
    execSync('git init', { cwd: repoDir });
    execSync('git config user.email "test@test.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });
    execSync('git commit --allow-empty -m "Initial commit"', { cwd: repoDir });
    worktreeDir = path.join(tmpDir, 'wt');
    execSync(`git worktree add -b task-smoke "${worktreeDir}"`, { cwd: repoDir });

    await fs.mkdir(path.join(tmpDir, 'wrapper'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'cache'), { recursive: true });
  }, 60_000);

  afterAll(async () => {
    if (savedXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdgConfigHome;
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('a task sandbox launches, commits to the linked worktree, and answers `nono why`', async () => {
    const mainGitDir = await getMainGitDir(worktreeDir);
    expect(mainGitDir).toBe(path.join(repoDir, '.git'));

    // The in-sandbox probe: a worktree write, a commit (main .git overlay
    // grants), and `nono why` through the OUIJIT_NONO_PATH shim target (the
    // --read-file grant on the vendored binary).
    const probe = [
      'set -e',
      'echo probe > probe.txt',
      'git add probe.txt',
      'git commit -qm smoke',
      '"$OUIJIT_NONO_PATH" why --path "$PWD" --op write',
      'echo SMOKE-OK',
    ].join('\n');

    const launch = buildNonoLaunch(
      nonoPath!,
      { file: '/bin/bash', args: ['-c', probe], env: {} },
      {
        worktreePath: worktreeDir,
        mainGitDir: mainGitDir!,
        apiPort: 45999,
        wrapperDir: path.join(tmpDir, 'wrapper'),
        cacheDir: path.join(tmpDir, 'cache'),
        nonoBinPath: nonoPath!,
      },
    );

    const { stdout, stderr } = await execFileAsync(launch.file, launch.args, {
      cwd: worktreeDir,
      env: { ...process.env, OUIJIT_NONO_PATH: nonoPath! },
      timeout: 60_000,
    }).catch((error: Error & { stdout?: string; stderr?: string }) => {
      throw new Error(`nono launch failed: ${error.message}\nstdout:\n${error.stdout}\nstderr:\n${error.stderr}`);
    });

    const output = stdout + stderr;
    expect(output).toContain('SMOKE-OK');
    expect(output).toContain('ALLOWED');
    expect(output).not.toMatch(/configuration parse error/i);

    // The commit escaped the sandbox into the main repo's object store.
    const log = execSync('git log --oneline task-smoke', { cwd: repoDir, encoding: 'utf8' });
    expect(log).toContain('smoke');
  }, 90_000);
});
