/**
 * What host git does in a task worktree whose git metadata a sandboxed agent
 * has rewritten. The agent can write the worktree's `.git` file and its own
 * entry under `.git/worktrees`, so either can point git at a repository whose
 * config runs a program. Ouijit's own calls must keep to the repository it
 * recorded and run nothing the repository names.
 */

import { test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createBranch, getGitStatus, getGitFileStatus, getWorktreeFileDiff, pushBranch } from '../../git';
import { getMainGitDir } from '../../sandbox/gitDir';
import { createTask, _resetCacheForTesting } from '../../db';

let tmpDir: string;
let repoDir: string;
let worktree: string;
let remote: string;
let marker: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A repository whose config runs a program at every chance git gives it, each one leaving `marker`. */
function plantTrap(): string {
  const trap = path.join(tmpDir, 'trap');
  git(tmpDir, 'init', '-q', '--initial-branch=trap', trap);
  git(trap, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'trap');
  const script = path.join(tmpDir, 'payload.sh');
  fs.writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
  const hooks = path.join(tmpDir, 'hooks');
  fs.mkdirSync(hooks);
  for (const hook of ['pre-push', 'post-checkout', 'pre-commit']) fs.copyFileSync(script, path.join(hooks, hook));
  const config = (key: string, value: string) => git(trap, 'config', key, value);
  config('core.fsmonitor', script);
  config('core.hooksPath', hooks);
  config('core.sshCommand', script);
  config('remote.origin.url', `ext::sh -c touch% '${marker}'`);
  return path.join(trap, '.git');
}

beforeEach(async () => {
  _resetCacheForTesting();
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-host-git-')));
  repoDir = path.join(tmpDir, 'project');
  worktree = path.join(tmpDir, 'worktrees', 'T-1');
  remote = path.join(tmpDir, 'remote.git');
  marker = path.join(tmpDir, 'pwned');

  git(tmpDir, 'init', '-q', '--bare', remote);
  fs.mkdirSync(repoDir);
  git(repoDir, 'init', '-q', '--initial-branch=main');
  git(repoDir, 'config', 'user.email', 'test@test.com');
  git(repoDir, 'config', 'user.name', 'Test');
  git(repoDir, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(repoDir, 'app.txt'), 'one\n');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-q', '-m', 'first');
  git(repoDir, 'worktree', 'add', '-q', '-b', 'task-1', worktree);
  await createTask(repoDir, 1, 'Task', { branch: 'task-1', worktreePath: worktree });

  fs.writeFileSync(path.join(worktree, 'app.txt'), 'one\ntwo\n');
  git(worktree, 'commit', '-q', '-am', 'second');
  fs.writeFileSync(path.join(worktree, 'app.txt'), 'one\ntwo\nthree\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test.each([
  ['the worktree’s .git file', (trap: string) => fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${trap}\n`)],
  [
    'its entry’s commondir',
    (trap: string) => fs.writeFileSync(path.join(repoDir, '.git', 'worktrees', 'T-1', 'commondir'), `${trap}\n`),
  ],
])(
  'status, diff, push and branch switches keep to the recorded repository after %s is pointed elsewhere',
  async (_, redirect) => {
    const trap = plantTrap();
    redirect(trap);

    // The trap is live: plain git in the worktree runs it.
    try {
      git(worktree, 'status');
    } catch {
      // A redirected commondir leaves git half-configured; the marker is what counts.
    }
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);

    expect(getGitStatus(worktree)).toEqual({ branch: 'task-1', isDirty: true });

    const status = await getGitFileStatus(worktree, 'main');
    expect(status?.branch).toBe('task-1');
    expect(status?.commitsAheadOfMain).toBe(1);
    expect(status?.changedFiles.map((f) => f.path)).toEqual(['app.txt']);

    const diff = await getWorktreeFileDiff(worktree, 'main', 'app.txt');
    expect(diff?.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'addition').map((l) => l.content))).toEqual([
      'two',
      'three',
    ]);

    expect(await pushBranch(worktree, 'task-1')).toEqual({ success: true });
    expect(git(remote, 'rev-parse', 'refs/heads/task-1')).toBe(git(repoDir, 'rev-parse', 'task-1'));

    expect(await getMainGitDir(repoDir)).toBe(path.join(repoDir, '.git'));

    // A branch switched to from Ouijit is the worktree's own once its pointers are put back.
    expect(createBranch(worktree, 'task-1-next')).toEqual({ success: true });
    expect(fs.existsSync(marker)).toBe(false);
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(repoDir, '.git', 'worktrees', 'T-1')}\n`);
    fs.writeFileSync(path.join(repoDir, '.git', 'worktrees', 'T-1', 'commondir'), '../..\n');
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('task-1-next');
  },
);
