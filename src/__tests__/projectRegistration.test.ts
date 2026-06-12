import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { addExistingProject, createAndRegisterProject } from '../services/projectRegistration';
import { getDefaultProjectsDir } from '../projectsFolder';
import { ONBOARDING_STATE_KEY } from '../onboardingState';
import { getAllProjects, getGlobalSetting } from '../db';

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-registration-test-'));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

async function onboardingState(): Promise<{ firstProjectPath?: string; source?: string } | null> {
  const raw = await getGlobalSetting(ONBOARDING_STATE_KEY);
  return raw ? (JSON.parse(raw) as { firstProjectPath?: string; source?: string }) : null;
}

describe('createAndRegisterProject', () => {
  test('creates the folder, registers it, sets the default folder, and records onboarding', async () => {
    const parentDir = path.join(scratchDir, 'workspace');

    const result = await createAndRegisterProject({ name: 'fresh-app', parentDir });

    const projectPath = path.join(parentDir, 'fresh-app');
    expect(result).toEqual({ success: true, projectPath });
    await expect(fs.access(path.join(projectPath, '.git'))).resolves.toBeUndefined();
    expect((await getAllProjects()).map((p) => p.path)).toContain(projectPath);
    expect(await getDefaultProjectsDir()).toBe(parentDir);
    expect(await onboardingState()).toMatchObject({ firstProjectPath: projectPath, source: 'created' });
  });

  test('registers nothing when creation fails', async () => {
    const result = await createAndRegisterProject({ name: '../escape', parentDir: scratchDir });

    expect(result.success).toBe(false);
    expect(await getAllProjects()).toEqual([]);
    expect(await onboardingState()).toBeNull();
  });
});

describe('addExistingProject', () => {
  test('registers a git repo and records onboarding', async () => {
    const repoPath = path.join(scratchDir, 'existing-app');
    await fs.mkdir(path.join(repoPath, '.git'), { recursive: true });

    const result = await addExistingProject(repoPath);

    expect(result).toEqual({ success: true });
    expect((await getAllProjects()).map((p) => p.path)).toContain(repoPath);
    expect(await onboardingState()).toMatchObject({ firstProjectPath: repoPath, source: 'added' });
  });

  test('rejects a folder that is not a git repo without registering it', async () => {
    const plainFolder = path.join(scratchDir, 'plain');
    await fs.mkdir(plainFolder);

    const result = await addExistingProject(plainFolder);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('not-a-git-repo');
    expect(await getAllProjects()).toEqual([]);
  });

  test('rejects a missing folder', async () => {
    const result = await addExistingProject(path.join(scratchDir, 'missing'));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not-found');
  });
});
