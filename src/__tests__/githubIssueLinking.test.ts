import { test, expect, vi } from 'vitest';
import { createTask, getTaskByNumber, setGlobalSetting } from '../db';
import { experimentalStorageKey } from '../experimentalFlags';
import { GithubError } from '../github/client';
import { createTaskFromIssue, linkTaskToIssue } from '../github/service';

const { ghGraphql } = vi.hoisted(() => ({
  ghGraphql: vi.fn<typeof import('../github/client').ghGraphql>(),
}));

vi.mock('../healthCheck', () => ({
  getCachedHealth: () => ({ gh: true, ghVersionOk: true }),
  currentHealth: async () => ({ gh: true, ghVersionOk: true }),
}));
vi.mock('../git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../git')>()),
  getRemoteUrl: async () => 'git@github.com:acme/app.git',
}));
vi.mock('../github/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/client')>()),
  ghGraphql,
  probeGhAuth: async () => true,
}));

const remoteIssues = [12, 30];

/** One issue by number, failing as `ghGraphql` does when GitHub reports NOT_FOUND. */
ghGraphql.mockImplementation(async (_query, variables = {}) => {
  const number = Number(variables.number);
  if (!remoteIssues.includes(number)) {
    throw new GithubError('not-found', `Could not resolve to an issue with the number of ${number}.`);
  }
  return {
    viewer: { login: 'me' },
    repository: {
      issue: {
        number,
        title: `Issue ${number}`,
        state: 'OPEN',
        body: '',
        url: `https://github.com/acme/app/issues/${number}`,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        author: { login: 'someone' },
        timelineItems: { nodes: [] },
      },
    },
  } as never;
});

test('a GitHub issue links to one task at a time, and only if it exists', async () => {
  const project = '/test/github-issue-linking';
  await setGlobalSetting(experimentalStorageKey(project), JSON.stringify({ github: true }));
  await createTask(project, 1, 'First');
  await createTask(project, 2, 'Second');
  const issueOf = async (n: number) => (await getTaskByNumber(project, n))?.githubIssueNumber;

  expect(await linkTaskToIssue(project, 1, 12)).toEqual({ success: true });
  expect(await issueOf(1)).toBe(12);

  expect(await linkTaskToIssue(project, 2, 12)).toMatchObject({ success: false, error: expect.stringContaining('#1') });
  expect((await createTaskFromIssue(project, 12)).success).toBe(false);
  expect(await linkTaskToIssue(project, 2, 404)).toEqual({ success: false, error: 'Issue #404 not found' });
  expect(await issueOf(2)).toBeUndefined();

  // Relinking the task that holds it is not a conflict; unlinking frees it for another.
  expect(await linkTaskToIssue(project, 1, 12)).toEqual({ success: true });
  expect(await linkTaskToIssue(project, 1, null)).toEqual({ success: true });
  expect(await linkTaskToIssue(project, 2, 12)).toEqual({ success: true });
  expect(await issueOf(1)).toBeUndefined();
});
