import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { getRemoteUrl as rawGetRemoteUrl } from '../git';
import { getRepoIdentity, invalidateRepoIdentity } from '../github/repoIdentity';

// vi.mock is hoisted above the imports, so the factory can't close over a
// top-level const. Reach the spy through the mocked module instead.
vi.mock('../git', () => ({ getRemoteUrl: vi.fn() }));

const getRemoteUrl = vi.mocked(rawGetRemoteUrl);

describe('getRepoIdentity', () => {
  beforeEach(() => {
    getRemoteUrl.mockReset();
    invalidateRepoIdentity();
  });

  afterEach(() => {
    invalidateRepoIdentity();
  });

  test('resolves and caches, so repeated calls do not respawn git', async () => {
    getRemoteUrl.mockResolvedValue('git@github.com:ouijit/ouijit.git');

    expect(await getRepoIdentity('/p')).toEqual({ host: 'github.com', owner: 'ouijit', repo: 'ouijit' });
    expect(await getRepoIdentity('/p')).toEqual({ host: 'github.com', owner: 'ouijit', repo: 'ouijit' });

    expect(getRemoteUrl).toHaveBeenCalledTimes(1);
  });

  test('caches a negative result too — a non-GitHub repo must not cost a subprocess per poll', async () => {
    getRemoteUrl.mockResolvedValue(null);

    expect(await getRepoIdentity('/p')).toBeNull();
    expect(await getRepoIdentity('/p')).toBeNull();

    expect(getRemoteUrl).toHaveBeenCalledTimes(1);
  });

  test('concurrent cold-cache callers share one lookup', async () => {
    getRemoteUrl.mockResolvedValue('git@github.com:o/r.git');

    const [a, b, c] = await Promise.all([getRepoIdentity('/p'), getRepoIdentity('/p'), getRepoIdentity('/p')]);

    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(getRemoteUrl).toHaveBeenCalledTimes(1);
  });

  test('caches per remote, not just per project', async () => {
    getRemoteUrl.mockImplementation(async (_path, remote) =>
      remote === 'upstream' ? 'git@github.com:upstream/repo.git' : 'git@github.com:fork/repo.git',
    );

    expect(await getRepoIdentity('/p', 'origin')).toMatchObject({ owner: 'fork' });
    expect(await getRepoIdentity('/p', 'upstream')).toMatchObject({ owner: 'upstream' });
  });

  test('invalidation actually re-reads — the whole point of adding it', async () => {
    getRemoteUrl.mockResolvedValue('git@github.com:old/name.git');
    expect(await getRepoIdentity('/p')).toMatchObject({ owner: 'old' });

    getRemoteUrl.mockResolvedValue('git@github.com:new/name.git');
    expect(await getRepoIdentity('/p')).toMatchObject({ owner: 'old' });

    invalidateRepoIdentity('/p');
    expect(await getRepoIdentity('/p')).toMatchObject({ owner: 'new' });
  });

  test('invalidating one project leaves the others cached', async () => {
    getRemoteUrl.mockResolvedValue('git@github.com:o/r.git');
    await getRepoIdentity('/a');
    await getRepoIdentity('/b');
    expect(getRemoteUrl).toHaveBeenCalledTimes(2);

    invalidateRepoIdentity('/a');
    await getRepoIdentity('/a');
    await getRepoIdentity('/b');

    expect(getRemoteUrl).toHaveBeenCalledTimes(3);
  });
});
