import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createTask, getTaskByNumber, setTaskGithubPr, setGlobalSetting } from '../db';
import { experimentalStorageKey } from '../experimentalFlags';
import { detectPullRequestsForProject, detectPullRequestForTask } from '../github/service';

const { runGh } = vi.hoisted(() => ({
  runGh: vi.fn<typeof import('../github/client').runGh>(),
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
  runGh,
  probeGhAuth: async () => true,
}));

interface RemotePr {
  number: number;
  headRefName: string;
  state: 'OPEN' | 'CLOSED';
  isCrossRepository: boolean;
}

let remotePrs: RemotePr[] = [];

/**
 * `gh pr list` over `remotePrs`, returning only the fields `--json` asks for, so
 * dropping a field from a query fails the tests that read it rather than
 * silently reading undefined.
 */
function ghPrList(args: string[]): string {
  const valueOf = (flag: string): string | null =>
    args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null;
  const head = valueOf('--head');
  const state = valueOf('--state');
  const fields = (valueOf('--json') ?? '').split(',');
  const matched = remotePrs.filter(
    (pr) => (head == null || pr.headRefName === head) && (state === 'all' || pr.state.toLowerCase() === state),
  );
  return JSON.stringify(matched.map((pr) => Object.fromEntries(fields.map((f) => [f, pr[f as keyof RemotePr]]))));
}

function openPr(number: number, headRefName: string, isCrossRepository = false): RemotePr {
  return { number, headRefName, state: 'OPEN', isCrossRepository };
}

function closedPr(number: number, headRefName: string): RemotePr {
  return { number, headRefName, state: 'CLOSED', isCrossRepository: false };
}

async function enableGithub(project: string): Promise<void> {
  await setGlobalSetting(experimentalStorageKey(project), JSON.stringify({ github: true }));
}

describe('pull request detection across a project', () => {
  beforeEach(() => {
    remotePrs = [];
    runGh.mockReset();
    runGh.mockImplementation(async (args) => ghPrList(args));
  });

  test('links a task to a pull request opened after its terminal spawned', async () => {
    const project = '/test/pr-detect-links';
    await enableGithub(project);
    await createTask(project, 1, 'Ship it', { branch: 'feat/ship' });
    remotePrs = [openPr(9, 'other/branch'), openPr(265, 'feat/ship')];

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 1 });
    expect((await getTaskByNumber(project, 1))?.githubPrNumber).toBe(265);

    runGh.mockClear();
    // Swept once already, so the second call is refused by the interval gate.
    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    expect(runGh).not.toHaveBeenCalled();
  });

  test('a project whose tasks are all linked detects without spawning `gh`', async () => {
    const project = '/test/pr-detect-nothing-unlinked';
    await enableGithub(project);
    await createTask(project, 1, 'Ship it', { branch: 'feat/ship' });
    await setTaskGithubPr(project, 1, 265);
    remotePrs = [openPr(265, 'feat/ship')];

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    // Null rather than 265: neither call linked anything, so neither is worth a refresh.
    expect(await detectPullRequestForTask(project, 1)).toEqual({ prNumber: null });
    expect(runGh).not.toHaveBeenCalled();
  });

  test('a branch two tasks share takes one link, on the task not yet finished', async () => {
    const project = '/test/pr-detect-shared';
    await enableGithub(project);
    await createTask(project, 1, 'Finished', { branch: 'feat/shared', status: 'done' });
    await createTask(project, 2, 'Current', { branch: 'feat/shared', status: 'in_progress' });
    remotePrs = [openPr(265, 'feat/shared'), openPr(266, 'feat/shared')];

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 1 });
    expect((await getTaskByNumber(project, 2))?.githubPrNumber).toBe(265);
    expect((await getTaskByNumber(project, 1))?.githubPrNumber).toBeUndefined();
  });

  test('a pull request another task already holds is left alone', async () => {
    const project = '/test/pr-detect-claimed';
    await enableGithub(project);
    await createTask(project, 1, 'First', { branch: 'feat/shared' });
    await createTask(project, 2, 'Second', { branch: 'feat/shared' });
    await setTaskGithubPr(project, 1, 265);
    remotePrs = [openPr(265, 'feat/shared')];

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    expect(await detectPullRequestForTask(project, 2)).toEqual({ prNumber: null });
    expect((await getTaskByNumber(project, 2))?.githubPrNumber).toBeUndefined();
  });

  test('a link made while `gh` was answering is not overwritten', async () => {
    const project = '/test/pr-detect-mid-flight';
    await enableGithub(project);
    await createTask(project, 1, 'First', { branch: 'feat/shared' });
    await createTask(project, 2, 'Second', { branch: 'feat/shared' });
    remotePrs = [openPr(265, 'feat/shared')];
    runGh.mockImplementation(async (args) => {
      await setTaskGithubPr(project, 2, 265);
      return ghPrList(args);
    });

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    expect((await getTaskByNumber(project, 1))?.githubPrNumber).toBeUndefined();
  });

  test("a fork's pull request never matches a local branch of the same name", async () => {
    const project = '/test/pr-detect-fork';
    await enableGithub(project);
    await createTask(project, 1, 'Ship it', { branch: 'patch-1' });
    remotePrs = [openPr(900, 'patch-1', true), closedPr(265, 'patch-1')];

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    // 900 is the fork's, 265 this repo's — closed, and still the only match.
    expect(await detectPullRequestForTask(project, 1)).toEqual({ prNumber: 265 });
  });

  // A separate project per failure, so the sweep's once-per-interval gate can't
  // stand in for the failure handling under test.
  test.each([
    ['fails', () => runGh.mockRejectedValue(new Error('gh: not authenticated'))],
    ['answers with an object', () => runGh.mockResolvedValue('{"message":"Not Found"}')],
  ])('a `gh` that %s leaves the task unlinked', async (label, breakGh) => {
    const project = `/test/pr-detect-gh-${label.replace(/ /g, '-')}`;
    await enableGithub(project);
    await createTask(project, 1, 'Ship it', { branch: 'feat/ship' });
    breakGh();

    expect(await detectPullRequestsForProject(project)).toEqual({ linked: 0 });
    expect(await detectPullRequestForTask(project, 1)).toEqual({ prNumber: null });
    expect((await getTaskByNumber(project, 1))?.githubPrNumber).toBeUndefined();
  });
});
