import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../healthCheck', () => ({
  getCachedHealth: () => ({ gh: true, ghVersionOk: true }),
}));
vi.mock('../github/repoIdentity', () => ({
  getRepoIdentity: async () => ({ owner: 'acme', repo: 'app' }),
}));

const { fetchOpenPullRequestBranches } = vi.hoisted(() => ({
  fetchOpenPullRequestBranches: vi.fn<typeof import('../github/api').fetchOpenPullRequestBranches>(),
}));

vi.mock('../github/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/api')>()),
  fetchOpenPullRequestBranches,
}));
vi.mock('../github/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/client')>()),
  probeGhAuth: async () => true,
}));

import { createTask, getTaskByNumber, setTaskGithubPr, setGlobalSetting } from '../db';
import { experimentalStorageKey } from '../experimentalFlags';
import { detectPullRequestsForProject } from '../github/service';

async function enableGithub(project: string): Promise<void> {
  await setGlobalSetting(experimentalStorageKey(project), JSON.stringify({ github: true }));
}

describe('pull request detection across a project', () => {
  beforeEach(() => {
    fetchOpenPullRequestBranches.mockReset();
  });

  test('links a task to a pull request opened after its terminal spawned', async () => {
    const project = '/test/pr-detect-links';
    await enableGithub(project);
    await createTask(project, 1, 'Ship it', { branch: 'feat/ship' });
    fetchOpenPullRequestBranches.mockResolvedValue([{ number: 265, headRefName: 'feat/ship' }]);

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 1 });
    expect((await getTaskByNumber(project, 1))?.githubPrNumber).toBe(265);

    fetchOpenPullRequestBranches.mockClear();
    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    expect(fetchOpenPullRequestBranches).not.toHaveBeenCalled();
  });

  test('a pull request another task already holds is left alone', async () => {
    const project = '/test/pr-detect-claimed';
    await enableGithub(project);
    await createTask(project, 1, 'First', { branch: 'feat/shared' });
    await createTask(project, 2, 'Second', { branch: 'feat/shared' });
    await setTaskGithubPr(project, 1, 265);
    fetchOpenPullRequestBranches.mockResolvedValue([{ number: 265, headRefName: 'feat/shared' }]);

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    expect((await getTaskByNumber(project, 2))?.githubPrNumber).toBeUndefined();
  });

  test('a branch with no open pull request stays unlinked', async () => {
    const project = '/test/pr-detect-none';
    await enableGithub(project);
    await createTask(project, 1, 'Ship it', { branch: 'feat/ship' });
    fetchOpenPullRequestBranches.mockResolvedValue([{ number: 9, headRefName: 'other/branch' }]);

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    expect((await getTaskByNumber(project, 1))?.githubPrNumber).toBeUndefined();
  });
});
