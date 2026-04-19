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
    name: 'Automate marketing screenshots via screencapture',
    status: 'in_progress',
    prompt: 'One command regenerates README + website imagery from a deterministic Ouijit state.',
    branch: 'automate-marketing-screenshots-324',
    mergeTarget: 'main',
  },
  {
    name: 'Sandbox isolation via dual-worktree architecture',
    status: 'in_progress',
    prompt: 'Replace in-guest bind-mount overlay with a host-side dual-worktree design.',
    branch: 'sandbox-dual-worktree-320',
    mergeTarget: 'main',
  },
  {
    name: 'Add drag handle to kanban cards',
    status: 'in_progress',
    prompt: 'Show a handle on hover so it is obvious cards are draggable.',
    branch: 'kanban-drag-handle-325',
    mergeTarget: 'main',
  },
  {
    name: 'Refine drag handle hover styles',
    status: 'in_progress',
    prompt: 'Child task of kanban drag handle — polish the hover affordance.',
    branch: 'kanban-drag-handle-hover-326',
    parentTaskNumber: 3,
    mergeTarget: 'kanban-drag-handle-325',
    sandboxed: true,
  },
  {
    name: 'Wire settings sync across windows',
    status: 'todo',
    prompt: 'Propagate project settings updates to all open Electron windows.',
  },
  {
    name: 'Ship keyboard shortcuts cheatsheet',
    status: 'todo',
    prompt: 'Press ? to open an overlay listing all project-mode shortcuts.',
  },
  {
    name: 'Fix terminal flicker on focus',
    status: 'todo',
    prompt: 'Switching tabs causes a 1-frame xterm re-render.',
  },
  {
    name: 'Speed up initial project scan',
    status: 'in_review',
    prompt: 'Parallelize language detection across project directories.',
    branch: 'speed-up-project-scan-318',
  },
  {
    name: 'Harden hook server auth',
    status: 'in_review',
    prompt: 'Per-PTY bearer tokens scoped to host vs sandbox.',
    branch: 'harden-hook-auth-318',
  },
  {
    name: 'Make canvas experimental',
    status: 'done',
    prompt: 'Hide the canvas view behind a per-project experimental toggle.',
    branch: 'canvas-experimental-313',
  },
  {
    name: 'Bulk task actions',
    status: 'done',
    prompt: 'Shift-click to select ranges, Cmd-click to toggle.',
    branch: 'bulk-task-actions-306',
  },
  {
    name: 'Add terminal plans management to the CLI',
    status: 'done',
    prompt: 'Let scripts associate a plan file with a terminal via ouijit CLI.',
    branch: 'terminal-plans-cli-304',
  },
];

export function seedCaptureFixture(db: Database.Database, tempRoot: string): CaptureFixtureResult {
  const projectName = 'Ouijit Demo';
  const projectPath = path.join(tempRoot, 'ouijit-demo');

  // Build a real git repo so the project scanner + worktree listing don't choke.
  fs.mkdirSync(projectPath, { recursive: true });
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projectPath });
    fs.writeFileSync(path.join(projectPath, 'README.md'), '# Ouijit Demo\n\nDemo project for capture mode.\n');
    fs.writeFileSync(path.join(projectPath, 'package.json'), '{\n  "name": "ouijit-demo",\n  "version": "1.0.0"\n}\n');
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
    const worktreePath = seed.branch ? path.join(tempRoot, 'worktrees', `T-${taskNumber}`) : undefined;
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
