import { describe, test, expect, vi, beforeEach } from 'vitest';
import { listUserRepos } from '../github/service';
import { fetchUserRepos as rawFetchUserRepos } from '../github/api';
import { getCachedHealth as rawGetCachedHealth } from '../healthCheck';
import { probeGh as rawProbeGh, probeGhAuth as rawProbeGhAuth } from '../github/client';

// The three real boundaries under `listUserRepos`: a `gh api` subprocess, the
// binary probe, and the auth probe. Everything else stays the real module.
vi.mock('../github/api', async () => ({
  ...(await vi.importActual<typeof import('../github/api')>('../github/api')),
  fetchUserRepos: vi.fn(),
}));
vi.mock('../healthCheck', async () => ({
  ...(await vi.importActual<typeof import('../healthCheck')>('../healthCheck')),
  getCachedHealth: vi.fn(),
}));
vi.mock('../github/client', async () => ({
  ...(await vi.importActual<typeof import('../github/client')>('../github/client')),
  probeGh: vi.fn(),
  probeGhAuth: vi.fn(),
}));

const fetchUserRepos = vi.mocked(rawFetchUserRepos);
const getCachedHealth = vi.mocked(rawGetCachedHealth);
const probeGh = vi.mocked(rawProbeGh);
const probeGhAuth = vi.mocked(rawProbeGhAuth);

const INSTALL = 'Install the GitHub CLI from cli.github.com to browse your repositories.';
const SIGN_IN = 'Run `gh auth login` in a terminal to browse your repositories.';

const REPOS = [
  {
    identity: { host: 'github.com', owner: 'pbjer', repo: 'ouijit' },
    description: 'Run agents in parallel',
    isPrivate: false,
  },
  { identity: { host: 'github.com', owner: 'pbjer', repo: 'notes' }, description: null, isPrivate: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  getCachedHealth.mockReturnValue(null);
});

describe('listUserRepos', () => {
  // One walk rather than four cases: the list is memoized for the life of the
  // process, so what each answer does to the next call is the behaviour, and
  // only an ordered sequence can show it.
  test('retries every failure the user can fix, and keeps only the success', async () => {
    probeGh.mockResolvedValue({ installed: false, versionOk: false });
    expect(await listUserRepos()).toEqual({ repos: [], message: INSTALL });
    expect(fetchUserRepos).not.toHaveBeenCalled();

    // Reached at all only because the answer above was not kept.
    probeGh.mockResolvedValue({ installed: true, versionOk: true, version: '2.60.0' });
    probeGhAuth.mockResolvedValue(false);
    expect(await listUserRepos()).toEqual({ repos: [], message: SIGN_IN });
    expect(fetchUserRepos).not.toHaveBeenCalled();

    probeGhAuth.mockResolvedValue(true);
    fetchUserRepos.mockRejectedValueOnce(new Error('API rate limit exceeded'));
    expect(await listUserRepos()).toEqual({ repos: [], message: 'API rate limit exceeded' });

    fetchUserRepos.mockResolvedValue(REPOS);
    expect(await listUserRepos()).toEqual({ repos: REPOS });

    // Kept: reopening the dialog does not fork `gh` again.
    expect(await listUserRepos()).toEqual({ repos: REPOS });
    expect(fetchUserRepos).toHaveBeenCalledTimes(2);
  });
});
