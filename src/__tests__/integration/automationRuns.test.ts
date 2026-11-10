/**
 * Automation runs end to end: a real git repo, a real database, and real
 * shells in PTYs. Only the window is absent, so the host records what the app
 * would have pushed and notified.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { _resetCacheForTesting, automations as repo, getTaskByNumber } from '../../db';
import { installShellIntegration, getShellIntegrationDir } from '../../shellIntegration';
import { cleanupAllPtys } from '../../ptyManager';
import {
  automationsSnapshot,
  createAutomation,
  deleteAutomation,
  makeTaskFromRun,
  notifyFromRun,
  openRun,
  runAutomationNow,
  startAutomations,
  stopAutomations,
  tick,
} from '../../automations/service';
import type { AutomationInput, AutomationRun } from '../../automations/types';

// A shell spawn asks Electron for the locale; before the app is ready there is none.
vi.mock('electron', () => ({
  app: { isReady: () => false, getPath: () => os.tmpdir() },
}));

let root: string;
let repoDir: string;
let notified: { title: string; body: string }[];

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-automations-')));
  // Run shells start from an empty home, without the user's rc files.
  process.env.HOME = path.join(root, 'home');
  fs.mkdirSync(process.env.HOME);
  process.env.SHELL = fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash';
  installShellIntegration(getShellIntegrationDir());
});

beforeEach(() => {
  _resetCacheForTesting();
  repoDir = fs.mkdtempSync(path.join(root, 'project-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=T commit -q --allow-empty -m init', { cwd: repoDir });
  notified = [];
  startAutomations({ changed: () => {}, notify: (title, body) => notified.push({ title, body }) });
});

afterEach(() => {
  stopAutomations();
  cleanupAllPtys();
});

function command(name: string, cmd: string, extra: Partial<AutomationInput> = {}): AutomationInput {
  return {
    name,
    kind: 'command',
    command: cmd,
    schedule: null,
    missed: 'run-once',
    location: 'worktree',
    sandbox: 'none',
    ...extra,
  };
}

async function settled(runId: string): Promise<AutomationRun> {
  for (let i = 0; i < 200; i++) {
    const run = repo().getRun(runId)!;
    if (run.state !== 'running' && run.state !== 'queued') return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run ${runId} never ended`);
}

const branches = () => execSync("git branch --format='%(refname:short)'", { cwd: repoDir, encoding: 'utf8' });

describe('automation runs', () => {
  test('a quiet run cleans up after itself; a failed one stays, tells the user, and can become a task', async () => {
    const quiet = createAutomation(repoDir, command('Echo', 'echo from-the-run'));
    const started = await runAutomationNow(quiet.id);
    expect(started.state).toBe('running');
    expect(started.ptyId).toBeTruthy();
    const worktree = repo().getRun(started.id)!.worktreePath!;
    expect(fs.existsSync(worktree)).toBe(true);

    const done = await settled(started.id);
    expect(done).toMatchObject({ state: 'quiet', exitCode: 0, unread: false });
    expect(done.output).toContain('from-the-run');
    expect(done.worktreePath).toBeUndefined();
    expect(fs.existsSync(worktree)).toBe(false);
    expect(branches()).not.toContain('automation/');
    expect(notified).toEqual([]);

    const failing = createAutomation(repoDir, command('Fails', 'echo broke && exit 3'));
    const failed = await settled((await runAutomationNow(failing.id)).id);
    expect(failed).toMatchObject({ state: 'failed', exitCode: 3, unread: true });
    expect(fs.existsSync(failed.worktreePath!)).toBe(true);
    expect(notified).toEqual([{ title: 'Fails', body: 'The run failed' }]);
    expect(await openRun(failed.id)).toEqual({ kind: 'output' });
    expect(repo().getRun(failed.id)!.unread).toBe(false);

    const taskNumber = await makeTaskFromRun(failed.id);
    const task = await getTaskByNumber(repoDir, taskNumber);
    expect(task).toMatchObject({ status: 'in_progress', worktreePath: failed.worktreePath, branch: failed.branch });
    expect(await makeTaskFromRun(failed.id)).toBe(taskNumber);
    expect(await openRun(failed.id)).toEqual({ kind: 'task', taskNumber });

    // Deleting the automation leaves the task its worktree.
    await deleteAutomation(failing.id);
    expect(fs.existsSync(failed.worktreePath!)).toBe(true);
    expect(automationsSnapshot(repoDir).automations.map((a) => a.name)).toEqual(['Echo']);
  });

  test('a run that notifies needs the user; a second run while one is going is skipped', async () => {
    const slow = createAutomation(repoDir, command('Slow', 'sleep 1', { location: 'project' }));
    const first = await runAutomationNow(slow.id);
    const second = await runAutomationNow(slow.id);
    expect(second).toMatchObject({ state: 'skipped', reason: 'The previous run was still going' });

    expect(() => notifyFromRun('pty-not-a-run', 'hi')).toThrow(/Not inside an automation run/);
    notifyFromRun(first.ptyId!, 'Two PRs need review');
    const done = await settled(first.id);
    expect(done).toMatchObject({ state: 'needs-you', summary: 'Two PRs need review', unread: true });
    expect(done.worktreePath).toBeUndefined();
    expect(notified).toEqual([{ title: 'Slow', body: 'Two PRs need review' }]);
  });

  test('the schedule fires what is due, and a missed run is caught up once or skipped', async () => {
    const now = new Date('2026-11-16T08:00:00');
    const due = createAutomation(repoDir, command('Due', 'true', { schedule: '0 8 * * *', location: 'project' }));
    const caughtUp = createAutomation(repoDir, command('Catch up', 'true', { schedule: '0 9 * * 1-5' }));
    const skipped = createAutomation(
      repoDir,
      command('Skip', 'true', { schedule: '0 9 * * 1-5', missed: 'skip', location: 'project' }),
    );
    repo().setNextRunAt(due.id, new Date('2026-11-16T08:00:00').toISOString());
    // Due last Wednesday; the Mac slept until Monday.
    repo().setNextRunAt(caughtUp.id, new Date('2026-11-11T09:00:00').toISOString());
    repo().setNextRunAt(skipped.id, new Date('2026-11-11T09:00:00').toISOString());

    await tick(now);

    const runsOf = (id: string) =>
      repo()
        .runs(repoDir)
        .filter((r) => r.automationId === id);
    expect(runsOf(due.id)).toMatchObject([{ trigger: 'schedule', scheduledFor: now.toISOString() }]);
    expect(runsOf(caughtUp.id)).toMatchObject([
      { trigger: 'catch-up', scheduledFor: new Date('2026-11-13T09:00:00').toISOString() },
    ]);
    expect(runsOf(skipped.id)).toMatchObject([{ state: 'skipped', trigger: 'schedule' }]);
    expect(notified).toContainEqual({ title: 'Catch up', body: 'Catching up on a missed run' });
    expect(repo().get(caughtUp.id)!.nextRunAt).toBe(new Date('2026-11-16T09:00:00').toISOString());

    // Nothing more is due on the next tick.
    await tick(new Date('2026-11-16T08:00:30'));
    expect(repo().runs(repoDir)).toHaveLength(3);
    await Promise.all(
      repo()
        .runs(repoDir)
        .map((r) => settled(r.id)),
    );
  });

  test('a run cut off by quitting is failed on the next start, and bad input is refused', () => {
    const automation = createAutomation(repoDir, command('Cut off', 'true'));
    const run = repo().addRun(automation, { state: 'running', trigger: 'manual' });
    stopAutomations();
    startAutomations({ changed: () => {}, notify: () => {} });
    expect(repo().getRun(run.id)).toMatchObject({ state: 'failed', reason: 'Ouijit quit before it finished' });

    expect(() => createAutomation(repoDir, command('Cut off', 'true'))).toThrow(/already an automation/);
    expect(() => createAutomation(repoDir, command('Fast', 'true', { schedule: '*/5 * * * *' }))).toThrow(
      /every 15 minutes/,
    );
    expect(() => createAutomation(repoDir, { ...command('Agent', ''), kind: 'agent' })).toThrow(/needs a prompt/);
  });
});
