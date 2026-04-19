/**
 * Capture-mode fixture seeder. Populates the temp SQLite DB with a single
 * project plus a mix of tasks, hooks, and scripts so screenshots look real
 * without having to spawn PTYs.
 *
 * Only invoked from main.ts when `OUIJIT_CAPTURE_MODE=1` and the DB is empty.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import { ProjectRepo } from '../db/repos/projectRepo';
import { TaskRepo } from '../db/repos/taskRepo';
import { HookRepo } from '../db/repos/hookRepo';
import { ScriptRepo } from '../db/repos/scriptRepo';
import { getLogger } from '../logger';

const captureFixtureLog = getLogger().scope('captureFixture');

export interface CaptureFixtureResult {
  projectPath: string;
  projectName: string;
}

export interface CaptureFixtureOptions {
  projectPath: string;
  projectName: string;
}

interface TaskSeed {
  name: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done';
  prompt?: string;
  branch?: string;
  mergeTarget?: string;
  parentTaskNumber?: number;
  sandboxed?: boolean;
}

const TASK_SEEDS: TaskSeed[] = [
  {
    name: 'Rework onboarding flow',
    status: 'in_progress',
    prompt: 'Split the onboarding wizard into focused steps and persist progress.',
    branch: 'rework-onboarding-flow-124',
    mergeTarget: 'main',
  },
  {
    name: 'Add activity feed to dashboard',
    status: 'in_progress',
    prompt: 'Stream recent events into a live activity feed on the dashboard.',
    branch: 'dashboard-activity-feed-120',
    mergeTarget: 'main',
  },
  {
    name: 'Polish invitation email template',
    status: 'in_progress',
    prompt: 'Tighten copy and add a clear CTA to the invitation email.',
    branch: 'invite-email-polish-119',
    mergeTarget: 'main',
  },
  {
    name: 'Refine CTA button hover states',
    status: 'in_progress',
    prompt: 'Child task of invitation polish — align hover states with the design tokens.',
    branch: 'cta-hover-states-121',
    parentTaskNumber: 3,
    mergeTarget: 'invite-email-polish-119',
    sandboxed: true,
  },
  {
    name: 'Wire settings sync across windows',
    status: 'todo',
    prompt: 'Propagate user settings updates to all open tabs and windows.',
  },
  {
    name: 'Ship keyboard shortcuts cheatsheet',
    status: 'todo',
    prompt: 'Press ? to open an overlay listing all keyboard shortcuts.',
  },
  {
    name: 'Fix table flicker on column resize',
    status: 'todo',
    prompt: 'Column resize causes a one-frame reflow in the data grid.',
  },
  {
    name: 'Speed up initial workspace scan',
    status: 'in_review',
    prompt: 'Parallelize workspace indexing on first load.',
    branch: 'speed-up-workspace-scan-116',
  },
  {
    name: 'Harden session auth middleware',
    status: 'in_review',
    prompt: 'Rotate session tokens on privilege change and scope them per origin.',
    branch: 'harden-session-auth-115',
  },
  {
    name: 'Make charts opt-in via feature flag',
    status: 'done',
    prompt: 'Hide the experimental charts panel behind a feature flag.',
    branch: 'charts-feature-flag-110',
  },
  {
    name: 'Bulk row actions',
    status: 'done',
    prompt: 'Shift-click to select ranges, Cmd-click to toggle.',
    branch: 'bulk-row-actions-108',
  },
  {
    name: 'Add CSV export to the reports page',
    status: 'done',
    prompt: 'Export current report view as CSV with applied filters.',
    branch: 'reports-csv-export-105',
  },
];

export function seedCaptureFixture(
  db: Database.Database,
  { projectPath, projectName }: CaptureFixtureOptions,
): CaptureFixtureResult {
  fs.mkdirSync(projectPath, { recursive: true });
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projectPath });
    fs.writeFileSync(path.join(projectPath, 'README.md'), `# ${projectName}\n`);
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      `{\n  "name": "${projectName}",\n  "version": "1.0.0"\n}\n`,
    );
    execFileSync('git', ['add', '.'], { cwd: projectPath });
    execFileSync(
      'git',
      ['-c', 'user.email=capture@ouijit.dev', '-c', 'user.name=Ouijit Capture', 'commit', '-q', '-m', 'Initial commit'],
      { cwd: projectPath },
    );
  } catch (err) {
    captureFixtureLog.warn('git init failed', { error: err instanceof Error ? err.message : String(err) });
  }

  const projectRepo = new ProjectRepo(db);
  const taskRepo = new TaskRepo(db);
  const hookRepo = new HookRepo(db);
  const scriptRepo = new ScriptRepo(db);

  projectRepo.add(projectPath, projectName);

  // Create tasks in seed order — task numbers match array index + 1.
  for (let i = 0; i < TASK_SEEDS.length; i++) {
    const seed = TASK_SEEDS[i];
    const taskNumber = i + 1;
    const worktreePath = seed.branch
      ? path.join(path.dirname(projectPath), `${projectName}-worktrees`, `T-${taskNumber}`)
      : undefined;
    taskRepo.create(projectPath, taskNumber, seed.name, {
      status: seed.status,
      prompt: seed.prompt,
      branch: seed.branch,
      mergeTarget: seed.mergeTarget,
      parentTaskNumber: seed.parentTaskNumber,
      sandboxed: seed.sandboxed,
      worktreePath,
      createdAt: new Date(Date.now() - (TASK_SEEDS.length - i) * 3600_000).toISOString(),
    });
  }

  hookRepo.save(
    projectPath,
    'start',
    'Claude',
    'claude --dangerously-skip-permissions "$OUIJIT_TASK_PROMPT"',
    undefined,
    'Launch Claude Code with the task prompt',
  );
  hookRepo.save(projectPath, 'continue', 'Resume', 'claude --continue', undefined, 'Continue a stopped Claude session');
  hookRepo.save(projectPath, 'run', 'Dev server', 'npm run dev', undefined, 'Start the Vite dev server');
  hookRepo.save(projectPath, 'review', 'Lint', 'npm run check', undefined, 'Type check + lint + format check');

  scriptRepo.save(projectPath, 'Install deps', 'npm install');
  scriptRepo.save(projectPath, 'Reset DB', 'npm run db:reset');
  scriptRepo.save(projectPath, 'Build CLI', 'npm run build:cli');
  scriptRepo.save(projectPath, 'Run tests', 'npm test');

  captureFixtureLog.info('fixture seeded', { projectPath, tasks: TASK_SEEDS.length });

  return { projectPath, projectName };
}
