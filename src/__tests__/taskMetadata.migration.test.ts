import { describe, test, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { app } from 'electron';
import { _initTestDatabase, getDatabase } from '../db/database';
import { ProjectRepo } from '../db/repos/projectRepo';
import { TaskRepo } from '../db/repos/taskRepo';
import { SettingsRepo } from '../db/repos/settingsRepo';
import { HookRepo } from '../db/repos/hookRepo';
import { importAll } from '../services/dataImportService';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

describe('data import service', () => {
  function setupImport() {
    const db = _initTestDatabase();
    const projectRepo = new ProjectRepo(db);
    const taskRepo = new TaskRepo(db);
    const settingsRepo = new SettingsRepo(db);
    const hookRepo = new HookRepo(db);

    // Remove marker file if exists
    const markerPath = path.join(app.getPath('userData'), 'data-imported');
    try { fs.unlinkSync(markerPath); } catch { /* ignore */ }

    return { db, projectRepo, taskRepo, settingsRepo, hookRepo };
  }

  test('imports tasks from task-metadata.json', async () => {
    const { db, projectRepo, taskRepo, settingsRepo, hookRepo } = setupImport();
    const userData = app.getPath('userData');

    // Write a fake task-metadata.json
    const taskStore = {
      __schemaVersion: 2,
      '/projects/myapp': {
        nextTaskNumber: 3,
        tasks: [
          {
            taskNumber: 1,
            branch: 'feat/login',
            name: 'Add login',
            status: 'in_progress',
            createdAt: '2024-01-01T00:00:00.000Z',
            mergeTarget: 'main',
            prompt: 'Build login page',
          },
          {
            taskNumber: 2,
            branch: 'feat/signup',
            name: 'Add signup',
            status: 'done',
            createdAt: '2024-01-02T00:00:00.000Z',
            closedAt: '2024-01-03T00:00:00.000Z',
          },
        ],
      },
    };
    fs.writeFileSync(path.join(userData, 'task-metadata.json'), JSON.stringify(taskStore));

    const result = await importAll(db, projectRepo, taskRepo, settingsRepo, hookRepo);

    expect(result.projectsImported).toBeGreaterThanOrEqual(1);
    expect(result.tasksImported).toBe(2);
    expect(result.errors).toHaveLength(0);

    // Verify tasks were imported
    const tasks = taskRepo.getAllForProject('/projects/myapp');
    expect(tasks).toHaveLength(2);
    expect(tasks.find(t => t.task_number === 1)?.branch).toBe('feat/login');
    expect(tasks.find(t => t.task_number === 2)?.status).toBe('done');
    expect(tasks.find(t => t.task_number === 2)?.closed_at).toBe('2024-01-03T00:00:00.000Z');

    // Verify counter was set
    expect(taskRepo.getNextTaskNumber('/projects/myapp')).toBe(3);
  });

  test('migrates v1 statuses during import', async () => {
    const { db, projectRepo, taskRepo, settingsRepo, hookRepo } = setupImport();
    const userData = app.getPath('userData');

    const taskStore = {
      '/projects/legacy': {
        nextTaskNumber: 4,
        tasks: [
          { taskNumber: 1, name: 'Open task', status: 'open', createdAt: '2024-01-01T00:00:00.000Z' },
          { taskNumber: 2, name: 'Ready task', status: 'open', readyToShip: true, createdAt: '2024-01-02T00:00:00.000Z' },
          { taskNumber: 3, name: 'Closed task', status: 'closed', createdAt: '2024-01-03T00:00:00.000Z' },
        ],
      },
    };
    fs.writeFileSync(path.join(userData, 'task-metadata.json'), JSON.stringify(taskStore));

    await importAll(db, projectRepo, taskRepo, settingsRepo, hookRepo);

    const tasks = taskRepo.getAllForProject('/projects/legacy');
    expect(tasks.find(t => t.task_number === 1)?.status).toBe('in_progress');
    expect(tasks.find(t => t.task_number === 2)?.status).toBe('in_review');
    expect(tasks.find(t => t.task_number === 3)?.status).toBe('done');
  });

  test('imports hooks from project-settings.json', async () => {
    const { db, projectRepo, taskRepo, settingsRepo, hookRepo } = setupImport();
    const userData = app.getPath('userData');

    const settingsStore = {
      '/projects/hooked': {
        hooks: {
          start: { id: 'h1', type: 'start', name: 'Setup', command: 'npm install' },
          cleanup: { id: 'h2', type: 'cleanup', name: 'Clean', command: 'rm -rf tmp' },
        },
        sandbox: { memoryGiB: 8 },
        killExistingOnRun: true,
      },
    };
    fs.writeFileSync(path.join(userData, 'project-settings.json'), JSON.stringify(settingsStore));

    const result = await importAll(db, projectRepo, taskRepo, settingsRepo, hookRepo);

    expect(result.hooksImported).toBe(2);
    expect(result.settingsImported).toBe(1);

    const hooks = hookRepo.getForProject('/projects/hooked');
    expect(hooks).toHaveLength(2);
    expect(hooks.find(h => h.type === 'start')?.command).toBe('npm install');

    const settings = settingsRepo.get('/projects/hooked');
    expect(settings?.sandbox_memory_gib).toBe(8);
    expect(settings?.kill_existing_on_run).toBe(1);
  });

  test('writes marker file and skips on subsequent runs', async () => {
    const { db, projectRepo, taskRepo, settingsRepo, hookRepo } = setupImport();

    // First run should succeed
    const result1 = await importAll(db, projectRepo, taskRepo, settingsRepo, hookRepo);
    expect(result1).toBeDefined();

    // Marker file should exist
    const markerPath = path.join(app.getPath('userData'), 'data-imported');
    expect(fs.existsSync(markerPath)).toBe(true);

    // Second run should be a no-op
    const result2 = await importAll(db, projectRepo, taskRepo, settingsRepo, hookRepo);
    expect(result2.projectsImported).toBe(0);
    expect(result2.tasksImported).toBe(0);
  });

  test('full round-trip: all three JSON files imported and readable through public API', async () => {
    const userData = app.getPath('userData');
    const markerPath = path.join(userData, 'data-imported');
    try { fs.unlinkSync(markerPath); } catch { /* ignore */ }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-test-'));
    vi.mocked(os.homedir).mockReturnValue(tmpDir);

    // Import the barrel — _resetCacheForTesting (from beforeEach) already
    // gave it a fresh in-memory DB. We'll import into that same DB, then
    // read back through the barrel's public functions.
    const barrel = await import('../db');

    try {
      // ── Write all three JSON files ──────────────────────────────────

      // 1. added-projects.json (~/Ouijit/)
      const ouijitDir = path.join(tmpDir, 'Ouijit');
      fs.mkdirSync(ouijitDir, { recursive: true });
      fs.writeFileSync(
        path.join(ouijitDir, 'added-projects.json'),
        JSON.stringify({ projects: ['/projects/myapp', '/projects/extra'] }),
      );

      // 2. task-metadata.json — v1 statuses, all optional fields, sort order
      const taskStore = {
        __schemaVersion: 2,
        '/projects/myapp': {
          nextTaskNumber: 4,
          tasks: [
            {
              taskNumber: 1, branch: 'feat/login', name: 'Add login',
              status: 'open', createdAt: '2024-01-01T00:00:00.000Z',
              mergeTarget: 'main', prompt: 'Build login page',
              worktreePath: '/worktrees/login', sandboxed: true, order: 5,
            },
            {
              taskNumber: 2, branch: 'feat/signup', name: 'Add signup',
              status: 'open', readyToShip: true,
              createdAt: '2024-01-02T00:00:00.000Z', order: 3,
            },
            {
              taskNumber: 3, name: 'Old closed task', status: 'closed',
              createdAt: '2024-01-03T00:00:00.000Z',
              closedAt: '2024-01-04T00:00:00.000Z',
            },
          ],
        },
      };
      fs.writeFileSync(path.join(userData, 'task-metadata.json'), JSON.stringify(taskStore));

      // 3. project-settings.json — hooks + sandbox + killExisting
      //    /projects/myapp appears in both task-metadata AND settings (dedup)
      const settingsStore = {
        '/projects/myapp': {
          hooks: {
            start: { id: 'h1', type: 'start', name: 'Setup', command: 'npm install' },
            cleanup: { id: 'h2', type: 'cleanup', name: 'Clean', command: 'rm -rf tmp', description: 'Tidy up' },
          },
          sandbox: { memoryGiB: 8, diskGiB: 200 },
          killExistingOnRun: true,
        },
      };
      fs.writeFileSync(path.join(userData, 'project-settings.json'), JSON.stringify(settingsStore));

      // ── Run import using the barrel's DB ────────────────────────────

      const db = getDatabase();
      const result = await importAll(
        db,
        new ProjectRepo(db),
        new TaskRepo(db),
        new SettingsRepo(db),
        new HookRepo(db),
      );

      expect(result.errors).toHaveLength(0);
      expect(result.tasksImported).toBe(3);
      expect(result.hooksImported).toBe(2);
      expect(result.settingsImported).toBe(1);

      // ── Read back through barrel module (public API) ────────────────

      // Tasks
      const tasks = await barrel.getProjectTasks('/projects/myapp');
      expect(tasks).toHaveLength(3);

      // v1 status migration
      const task1 = tasks.find(t => t.taskNumber === 1)!;
      expect(task1.status).toBe('in_progress');   // open → in_progress
      const task2 = tasks.find(t => t.taskNumber === 2)!;
      expect(task2.status).toBe('in_review');      // open+readyToShip → in_review
      const task3 = tasks.find(t => t.taskNumber === 3)!;
      expect(task3.status).toBe('done');           // closed → done

      // All optional fields preserved
      expect(task1.branch).toBe('feat/login');
      expect(task1.mergeTarget).toBe('main');
      expect(task1.prompt).toBe('Build login page');
      expect(task1.worktreePath).toBe('/worktrees/login');
      expect(task1.sandboxed).toBe(true);
      expect(task1.order).toBe(5);

      // closedAt preserved
      expect(task3.closedAt).toBe('2024-01-04T00:00:00.000Z');

      // sort_order preserved
      expect(task2.order).toBe(3);

      // Counter preserved
      const nextNum = await barrel.getNextTaskNumber('/projects/myapp');
      expect(nextNum).toBe(4);

      // Settings
      const settings = await barrel.getProjectSettings('/projects/myapp');
      expect(settings.hooks?.start?.command).toBe('npm install');
      expect(settings.hooks?.cleanup?.command).toBe('rm -rf tmp');
      expect(settings.hooks?.cleanup?.description).toBe('Tidy up');
      expect(settings.sandbox?.memoryGiB).toBe(8);
      expect(settings.sandbox?.diskGiB).toBe(200);
      expect(settings.killExistingOnRun).toBe(true);

      // Hook lookup by type
      const startHook = await barrel.getHook('/projects/myapp', 'start');
      expect(startHook?.id).toBe('h1');
      expect(startHook?.name).toBe('Setup');

      // Dedup: /projects/myapp appears in added-projects + task-metadata + settings
      // but should exist as one project row
      const projectRepo = new ProjectRepo(db);
      const allProjects = projectRepo.getAll();
      const myappCount = allProjects.filter(p => p.path === '/projects/myapp').length;
      expect(myappCount).toBe(1);

      // /projects/extra from added-projects.json also imported
      expect(projectRepo.getByPath('/projects/extra')).toBeDefined();
    } finally {
      vi.mocked(os.homedir).mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('imports added projects from added-projects.json', async () => {
    const { db, projectRepo, taskRepo, settingsRepo, hookRepo } = setupImport();

    // Use a temp directory instead of real home to avoid touching ~/Ouijit/
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-test-'));
    vi.mocked(os.homedir).mockReturnValue(tmpDir);

    try {
      const addedProjectsDir = path.join(tmpDir, 'Ouijit');
      fs.mkdirSync(addedProjectsDir, { recursive: true });
      fs.writeFileSync(
        path.join(addedProjectsDir, 'added-projects.json'),
        JSON.stringify({ projects: ['/tmp/test-project-import'] })
      );

      const result = await importAll(db, projectRepo, taskRepo, settingsRepo, hookRepo);
      expect(result.projectsImported).toBeGreaterThanOrEqual(1);

      const project = projectRepo.getByPath('/tmp/test-project-import');
      expect(project).toBeDefined();
      expect(project?.name).toBe('test-project-import');
    } finally {
      vi.mocked(os.homedir).mockRestore();
      // Clean up temp dir
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
