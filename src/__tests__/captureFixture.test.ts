import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _initTestDatabase, closeDatabase } from '../db/database';
import { seedCaptureFixture } from '../capture/fixture';
import { TaskRepo } from '../db/repos/taskRepo';
import { ProjectRepo } from '../db/repos/projectRepo';
import { HookRepo } from '../db/repos/hookRepo';
import { ScriptRepo } from '../db/repos/scriptRepo';
import { execFileSync } from 'node:child_process';

describe('seedCaptureFixture', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-fixture-'));
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('seeds a project with tasks across all four columns', () => {
    const db = _initTestDatabase();

    const projectPath = path.join(tempRoot, 'horizon');
    const result = seedCaptureFixture(db, { projectPath, projectName: 'horizon' });

    expect(result.projectPath).toBe(projectPath);
    expect(fs.existsSync(path.join(result.projectPath, '.git'))).toBe(true);

    const projects = new ProjectRepo(db).getAll();
    expect(projects).toHaveLength(1);
    expect(projects[0].path).toBe(result.projectPath);
    expect(projects[0].name).toBe('horizon');

    const tasks = new TaskRepo(db).getAllForProject(result.projectPath);
    const statuses = new Set(tasks.map((t) => t.status));
    expect(statuses).toEqual(new Set(['todo', 'in_progress', 'in_review', 'done']));
  });

  test('seeds hooks and scripts', () => {
    const db = _initTestDatabase();

    const projectPath = path.join(tempRoot, 'horizon');
    const { projectPath: seeded } = seedCaptureFixture(db, { projectPath, projectName: 'horizon' });

    const hooks = new HookRepo(db).getForProject(seeded);
    expect(hooks.length).toBeGreaterThanOrEqual(3);
    const hookTypes = new Set(hooks.map((h) => h.type));
    expect(hookTypes.has('start')).toBe(true);
    expect(hookTypes.has('run')).toBe(true);

    const scripts = new ScriptRepo(db).getAll(seeded);
    expect(scripts.length).toBeGreaterThanOrEqual(3);
  });

  test('creates worktrees on the task branches, with the diff and lens scenes staged', () => {
    const db = _initTestDatabase();

    const projectPath = path.join(tempRoot, 'horizon');
    seedCaptureFixture(db, { projectPath, projectName: 'horizon' });

    const worktree = path.join(tempRoot, 'horizon-worktrees', 'T-1');
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: worktree, encoding: 'utf8' });
    expect(branch.trim()).toBe('rework-onboarding-flow-124');

    const status = execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' });
    expect(status).toContain(' M src/onboarding/Stepper.tsx');
    expect(status).toContain('?? src/onboarding/IntroCard.tsx');

    // The paths the lens scene's groups name, and the two hunks it splits
    // Dashboard.tsx across. A rename here empties a group rather than failing
    // anything, so the shot would come out with a heading over nothing.
    const lensTree = path.join(tempRoot, 'horizon-worktrees', 'T-2');
    // `-uall` because that is what the panel lists: without it git collapses a
    // wholly untracked directory to the directory, and two of the parts name
    // files inside one.
    const lensStatus = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: lensTree, encoding: 'utf8' });
    expect(lensStatus).toContain(' M src/dashboard/Dashboard.tsx');
    expect(lensStatus).toContain('?? src/api/activity.ts');
    expect(lensStatus).toContain('?? src/dashboard/ActivityFeed.tsx');
    expect(lensStatus).toContain('?? src/dashboard/activity.css');
    expect(lensStatus).toContain('?? src/api/__tests__/activity.test.ts');

    const hunks = execFileSync('git', ['diff', '--unified=3', '--', 'src/dashboard/Dashboard.tsx'], {
      cwd: lensTree,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.startsWith('@@'));
    expect(hunks).toHaveLength(2);

    const rootStatus = execFileSync('git', ['status', '--porcelain'], { cwd: projectPath, encoding: 'utf8' });
    expect(rootStatus).toBe('');
  });
});
