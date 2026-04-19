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
    expect(tasks.some((t) => t.parent_task_number !== null)).toBe(true);
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
});
