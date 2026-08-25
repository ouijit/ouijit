import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resolveRepo } from '../github/service';
import { fetchRepo as rawFetchRepo } from '../github/api';
import { checkHealth as rawCheckHealth, getCachedHealth as rawGetCachedHealth } from '../healthCheck';
import { GithubError, type GithubErrorKind } from '../github/client';
import type { HealthStatus } from '../healthCheck';

// The three real boundaries under `resolveRepo`: a `gh api` subprocess, the
// binary probe, and the auth probe. Everything else stays the real module.
vi.mock('../github/api', async () => ({
  ...(await vi.importActual<typeof import('../github/api')>('../github/api')),
  fetchRepo: vi.fn(),
}));
vi.mock('../healthCheck', async () => ({
  ...(await vi.importActual<typeof import('../healthCheck')>('../healthCheck')),
  getCachedHealth: vi.fn(),
  checkHealth: vi.fn(),
}));
vi.mock('../github/client', async () => ({
  ...(await vi.importActual<typeof import('../github/client')>('../github/client')),
  probeGhAuth: vi.fn().mockResolvedValue(true),
}));

const fetchRepo = vi.mocked(rawFetchRepo);
const checkHealth = vi.mocked(rawCheckHealth);
const getCachedHealth = vi.mocked(rawGetCachedHealth);

const HEALTHY = { gh: true, ghVersionOk: true } as HealthStatus;
const REPO = { slug: 'macro-inc/macro', description: 'A workspace', isPrivate: false };

beforeEach(() => {
  vi.clearAllMocks();
  getCachedHealth.mockReturnValue(HEALTHY);
});

describe('resolveRepo', () => {
  test('confirms a repo GitHub returns, carrying its details', async () => {
    fetchRepo.mockResolvedValue(REPO);

    await expect(resolveRepo('https://github.com/macro-inc/macro')).resolves.toEqual({
      status: 'found',
      repo: REPO,
    });
    expect(fetchRepo).toHaveBeenCalledWith({ host: 'github.com', owner: 'macro-inc', repo: 'macro' });
  });

  test('reports a 404 as not-found, which is the only answer that blocks a clone', async () => {
    fetchRepo.mockRejectedValue(new GithubError('not-found', 'nope'));
    await expect(resolveRepo('macro-inc/marco')).resolves.toEqual({ status: 'not-found' });
  });

  // A missing answer is not a negative one: these all leave the clone enabled.
  test.each<GithubErrorKind>(['rate-limited', 'network', 'unauthorized', 'forbidden', 'unknown', 'gh-missing'])(
    'answers unknown rather than not-found when gh fails with %s',
    async (kind) => {
      fetchRepo.mockRejectedValue(new GithubError(kind, 'boom'));
      await expect(resolveRepo('macro-inc/macro')).resolves.toEqual({ status: 'unknown' });
    },
  );

  test('answers unknown without probing when gh is not installed', async () => {
    getCachedHealth.mockReturnValue(null);
    checkHealth.mockResolvedValue({ ...HEALTHY, gh: false });

    await expect(resolveRepo('macro-inc/macro')).resolves.toEqual({ status: 'unknown' });
    expect(fetchRepo).not.toHaveBeenCalled();
  });

  test('answers unknown for input that is not a repository', async () => {
    await expect(resolveRepo('not a repo')).resolves.toEqual({ status: 'unknown' });
    expect(fetchRepo).not.toHaveBeenCalled();
  });
});
