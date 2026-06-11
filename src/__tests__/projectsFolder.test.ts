import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getDefaultProjectsDir,
  getFallbackProjectsDir,
  setDefaultProjectsDir,
  scanSiblingProjects,
  moveProjects,
  PROJECTS_FOLDER_KEY,
} from '../projectsFolder';
import { createProject } from '../projectCreator';
import { addProject, getAllProjects, getProjectTasks, createTask, getHooks, saveHook, getGlobalSetting } from '../db';

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'projects-folder-test-'));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

/** Creates a directory that passes the `.git` presence check without running git. */
async function makeFakeRepo(parent: string, name: string): Promise<string> {
  const repoPath = path.join(parent, name);
  await fs.mkdir(path.join(repoPath, '.git'), { recursive: true });
  return repoPath;
}

describe('getDefaultProjectsDir', () => {
  test('falls back to ~/Ouijit/projects when no setting is stored', async () => {
    expect(await getDefaultProjectsDir()).toBe(getFallbackProjectsDir());
    expect(getFallbackProjectsDir()).toBe(path.join(os.homedir(), 'Ouijit', 'projects'));
  });

  test('returns the configured folder once set', async () => {
    await setDefaultProjectsDir(scratchDir);
    expect(await getDefaultProjectsDir()).toBe(scratchDir);
    expect(await getGlobalSetting(PROJECTS_FOLDER_KEY)).toBe(scratchDir);
  });

  test('ignores a non-absolute stored value', async () => {
    await setDefaultProjectsDir('relative/path');
    expect(await getDefaultProjectsDir()).toBe(getFallbackProjectsDir());
  });
});

describe('scanSiblingProjects', () => {
  test('finds unregistered sibling git repos, skipping non-repos and hidden dirs', async () => {
    const added = await makeFakeRepo(scratchDir, 'added');
    const siblingA = await makeFakeRepo(scratchDir, 'sibling-a');
    const siblingB = await makeFakeRepo(scratchDir, 'sibling-b');
    await fs.mkdir(path.join(scratchDir, 'plain-folder'));
    await makeFakeRepo(scratchDir, '.hidden-repo');

    const result = await scanSiblingProjects(added);
    expect(result.parentDir).toBe(scratchDir);
    expect(result.siblings).toEqual([siblingA, siblingB]);
  });

  test('excludes already-registered projects', async () => {
    const added = await makeFakeRepo(scratchDir, 'added');
    const registered = await makeFakeRepo(scratchDir, 'registered');
    const fresh = await makeFakeRepo(scratchDir, 'fresh');
    await addProject(registered);

    const result = await scanSiblingProjects(added);
    expect(result.siblings).toEqual([fresh]);
  });

  test('returns empty when the parent directory is unreadable', async () => {
    const result = await scanSiblingProjects(path.join(scratchDir, 'missing', 'repo'));
    expect(result.siblings).toEqual([]);
  });
});

describe('moveProjects', () => {
  test('moves the directory and rewrites every stored path', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);
    await createTask(projectPath, 1, 'First task', { status: 'todo' });
    await saveHook(projectPath, { id: 'h1', type: 'start', name: 'Setup', command: 'npm install' });

    const result = await moveProjects([projectPath], newFolder);

    const newPath = path.join(newFolder, 'my-app');
    expect(result.success).toBe(true);
    expect(result.moved).toEqual([{ from: projectPath, to: newPath }]);
    expect(result.failed).toEqual([]);

    // Directory physically moved
    await expect(fs.access(newPath)).resolves.toBeUndefined();
    await expect(fs.access(projectPath)).rejects.toThrow();

    // All database rows follow the new path
    const projects = await getAllProjects();
    expect(projects.map((p) => p.path)).toContain(newPath);
    expect(projects.map((p) => p.path)).not.toContain(projectPath);
    const tasks = await getProjectTasks(newPath);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe('First task');
    const hooks = await getHooks(newPath);
    expect(hooks.start?.command).toBe('npm install');
  });

  test('fails a project whose name already exists in the target folder', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await makeFakeRepo(newFolder, 'my-app');
    await addProject(projectPath);

    const result = await moveProjects([projectPath], newFolder);

    expect(result.success).toBe(false);
    expect(result.moved).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe(projectPath);
    // Untouched on disk and in the registry
    await expect(fs.access(projectPath)).resolves.toBeUndefined();
    expect((await getAllProjects()).map((p) => p.path)).toContain(projectPath);
  });

  test('rejects paths that are not registered projects', async () => {
    const stray = await makeFakeRepo(scratchDir, 'stray');
    const result = await moveProjects([stray], path.join(scratchDir, 'new'));
    expect(result.success).toBe(false);
    expect(result.failed).toEqual([{ path: stray, error: 'Not a registered project' }]);
  });

  test('one failure does not stop the other projects from moving', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    const blocked = await makeFakeRepo(oldFolder, 'blocked');
    const movable = await makeFakeRepo(oldFolder, 'movable');
    await makeFakeRepo(newFolder, 'blocked');
    await addProject(blocked);
    await addProject(movable);

    const result = await moveProjects([blocked, movable], newFolder);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe(blocked);
    expect(result.moved).toEqual([{ from: movable, to: path.join(newFolder, 'movable') }]);
  });
});

describe('createProject with a custom parent directory', () => {
  test('creates the project inside parentDir', async () => {
    const parentDir = path.join(scratchDir, 'workspace');
    const result = await createProject({ name: 'fresh-app', parentDir });
    expect(result.success).toBe(true);
    expect(result.projectPath).toBe(path.join(parentDir, 'fresh-app'));
    await expect(fs.access(path.join(parentDir, 'fresh-app', '.git'))).resolves.toBeUndefined();
  });

  test('uses the configured default folder when parentDir is omitted', async () => {
    const configured = path.join(scratchDir, 'configured');
    await setDefaultProjectsDir(configured);
    const result = await createProject({ name: 'settled-app' });
    expect(result.success).toBe(true);
    expect(result.projectPath).toBe(path.join(configured, 'settled-app'));
  });

  test('still rejects names that escape the projects directory', async () => {
    const parentDir = path.join(scratchDir, 'workspace');
    const result = await createProject({ name: '../escape', parentDir });
    expect(result.success).toBe(false);
  });
});
