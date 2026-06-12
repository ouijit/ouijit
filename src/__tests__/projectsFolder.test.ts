import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Pass-through mock so one test can make the path migration fail and exercise
// moveProjects' rollback; every other test gets the real implementation.
const pathRenameControl = vi.hoisted(() => ({ failNext: false }));
vi.mock('../services/projectPathRename', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/projectPathRename')>();
  return {
    renameProjectPath: async (oldPath: string, newPath: string) => {
      if (pathRenameControl.failNext) {
        pathRenameControl.failNext = false;
        throw new Error('database unavailable');
      }
      return actual.renameProjectPath(oldPath, newPath);
    },
  };
});
import {
  getDefaultProjectsDir,
  getFallbackProjectsDir,
  setDefaultProjectsDir,
  scanSiblingProjects,
  moveProjects,
  prepareProjectsFolderChange,
  applyProjectsFolderChange,
  PROJECTS_FOLDER_KEY,
} from '../projectsFolder';
import { createProject } from '../projectCreator';
import { writeUserConfig, configExists } from '../lima/configStore';
import {
  addProject,
  getAllProjects,
  getProjectTasks,
  createTask,
  getHooks,
  saveHook,
  getGlobalSetting,
  setGlobalSetting,
  removeProject,
} from '../db';

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

const noActiveSessions = new Set<string>();
const applyOptions = (active: Set<string> = noActiveSessions) => ({
  activeProjectPaths: active,
  removeProject: async (projectPath: string) => {
    await removeProject(projectPath);
  },
});

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

  test('migrates path-keyed global settings with the project', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);
    await setGlobalSetting(`canvas:${projectPath}`, '{"nodes":[]}');
    await setGlobalSetting(`worktree:${projectPath}`, 'clean-checkout');
    await setGlobalSetting(`experimental:${projectPath}`, '{"flags":1}');

    await moveProjects([projectPath], newFolder);

    const newPath = path.join(newFolder, 'my-app');
    expect(await getGlobalSetting(`canvas:${newPath}`)).toBe('{"nodes":[]}');
    expect(await getGlobalSetting(`worktree:${newPath}`)).toBe('clean-checkout');
    expect(await getGlobalSetting(`experimental:${newPath}`)).toBe('{"flags":1}');
    expect(await getGlobalSetting(`canvas:${projectPath}`)).toBeUndefined();
    expect(await getGlobalSetting(`worktree:${projectPath}`)).toBeUndefined();
  });

  test('migrates the sandbox config file with the project', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);
    await writeUserConfig(projectPath, 'cpus: 4\n');

    await moveProjects([projectPath], newFolder);

    const newPath = path.join(newFolder, 'my-app');
    expect(await configExists(newPath)).toBe(true);
    expect(await configExists(projectPath)).toBe(false);
  });

  test('rejects a new folder nested inside a project being moved, without creating it', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);
    const nested = path.join(projectPath, 'projects');

    const result = await moveProjects([projectPath], nested);

    expect(result.moved).toEqual([]);
    expect(result.failed).toEqual([{ path: projectPath, error: 'The new folder is inside "my-app"' }]);
    await expect(fs.access(nested)).rejects.toThrow();
    await expect(fs.access(projectPath)).resolves.toBeUndefined();
  });

  test('rejects a relative new folder', async () => {
    const projectPath = await makeFakeRepo(scratchDir, 'my-app');
    await addProject(projectPath);
    const result = await moveProjects([projectPath], 'relative/folder');
    expect(result.failed).toEqual([{ path: projectPath, error: 'The new folder must be an absolute path' }]);
  });

  test('fails a project whose name already exists in the target folder', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await makeFakeRepo(newFolder, 'my-app');
    await addProject(projectPath);

    const result = await moveProjects([projectPath], newFolder);

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
    expect(result.failed).toEqual([{ path: stray, error: 'Not a registered project' }]);
  });

  test('rolls the directory rename back when the path migration fails', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);
    pathRenameControl.failNext = true;

    const result = await moveProjects([projectPath], newFolder);

    expect(result.moved).toEqual([]);
    expect(result.failed).toEqual([{ path: projectPath, error: 'database unavailable' }]);
    // Directory restored so disk and registry stay consistent
    await expect(fs.access(projectPath)).resolves.toBeUndefined();
    await expect(fs.access(path.join(newFolder, 'my-app'))).rejects.toThrow();
    expect((await getAllProjects()).map((p) => p.path)).toContain(projectPath);
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

describe('prepareProjectsFolderChange', () => {
  test('commits immediately when no projects live in the current folder', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    await setDefaultProjectsDir(oldFolder);

    const plan = await prepareProjectsFolderChange(newFolder, noActiveSessions);

    expect(plan.status).toBe('committed');
    expect(await getDefaultProjectsDir()).toBe(newFolder);
  });

  test('asks for a decision when projects live in the current folder', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    await setDefaultProjectsDir(oldFolder);
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);

    const plan = await prepareProjectsFolderChange(newFolder, new Set([projectPath]));

    expect(plan.status).toBe('needs-decision');
    expect(plan.affected).toEqual([{ path: projectPath, name: 'my-app', hasActiveSessions: true }]);
    // Not committed until the user decides
    expect(await getDefaultProjectsDir()).toBe(oldFolder);
  });

  test('reports unchanged and invalid folders without committing', async () => {
    await setDefaultProjectsDir(scratchDir);
    expect((await prepareProjectsFolderChange(scratchDir, noActiveSessions)).status).toBe('unchanged');
    expect((await prepareProjectsFolderChange('relative/path', noActiveSessions)).status).toBe('invalid');
    expect(await getDefaultProjectsDir()).toBe(scratchDir);
  });
});

describe('applyProjectsFolderChange', () => {
  test('move relocates the projects and commits', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    await setDefaultProjectsDir(oldFolder);
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);

    const result = await applyProjectsFolderChange(newFolder, 'move', applyOptions());

    expect(result.committed).toBe(true);
    expect(result.moved).toEqual([{ from: projectPath, to: path.join(newFolder, 'my-app') }]);
    expect(await getDefaultProjectsDir()).toBe(newFolder);
  });

  test('move does not commit when a relocation fails', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    await setDefaultProjectsDir(oldFolder);
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await makeFakeRepo(newFolder, 'my-app'); // name conflict
    await addProject(projectPath);

    const result = await applyProjectsFolderChange(newFolder, 'move', applyOptions());

    expect(result.committed).toBe(false);
    expect(result.failed).toHaveLength(1);
    // Setting still points at the old folder, so the change can be retried.
    expect(await getDefaultProjectsDir()).toBe(oldFolder);
  });

  test('move refuses projects with active terminal sessions and does not commit', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    await setDefaultProjectsDir(oldFolder);
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);

    const result = await applyProjectsFolderChange(newFolder, 'move', applyOptions(new Set([projectPath])));

    expect(result.committed).toBe(false);
    expect(result.moved).toEqual([]);
    expect(result.failed).toEqual([{ path: projectPath, error: 'Close its running terminal sessions first' }]);
    await expect(fs.access(projectPath)).resolves.toBeUndefined();
    expect(await getDefaultProjectsDir()).toBe(oldFolder);
  });

  test('forget unregisters the projects, keeps the folders, and commits', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    await setDefaultProjectsDir(oldFolder);
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);

    const result = await applyProjectsFolderChange(newFolder, 'forget', applyOptions());

    expect(result.committed).toBe(true);
    expect((await getAllProjects()).map((p) => p.path)).not.toContain(projectPath);
    await expect(fs.access(projectPath)).resolves.toBeUndefined();
    expect(await getDefaultProjectsDir()).toBe(newFolder);
  });

  test('forget reports projects that fail to unregister and still commits', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    await setDefaultProjectsDir(oldFolder);
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);

    const result = await applyProjectsFolderChange(newFolder, 'forget', {
      activeProjectPaths: noActiveSessions,
      removeProject: async () => {
        throw new Error('cleanup failed');
      },
    });

    expect(result.committed).toBe(true);
    expect(result.failed).toEqual([{ path: projectPath, error: 'cleanup failed' }]);
    expect(await getDefaultProjectsDir()).toBe(newFolder);
  });

  test('keep leaves the projects alone and commits', async () => {
    const oldFolder = path.join(scratchDir, 'old');
    const newFolder = path.join(scratchDir, 'new');
    await setDefaultProjectsDir(oldFolder);
    const projectPath = await makeFakeRepo(oldFolder, 'my-app');
    await addProject(projectPath);

    const result = await applyProjectsFolderChange(newFolder, 'keep', applyOptions());

    expect(result.committed).toBe(true);
    expect((await getAllProjects()).map((p) => p.path)).toContain(projectPath);
    expect(await getDefaultProjectsDir()).toBe(newFolder);
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

  test('rejects a relative parentDir', async () => {
    const result = await createProject({ name: 'fresh-app', parentDir: 'relative/workspace' });
    expect(result.success).toBe(false);
  });

  test('still rejects names that escape the projects directory', async () => {
    const parentDir = path.join(scratchDir, 'workspace');
    const result = await createProject({ name: '../escape', parentDir });
    expect(result.success).toBe(false);
  });
});
