import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { getRemoteUrl as rawGetRemoteUrl } from '../git';
import { parseRemoteUrl, isDotCom, getRepoIdentity, invalidateRepoIdentity } from '../github/repoIdentity';

// vi.mock is hoisted above the imports, so the factory can't close over a
// top-level const. Reach the spy through the mocked module instead.
vi.mock('../git', () => ({ getRemoteUrl: vi.fn() }));

const getRemoteUrl = vi.mocked(rawGetRemoteUrl);

describe('parseRemoteUrl', () => {
  test.each([
    ['git@github.com:ouijit/ouijit.git', 'github.com', 'ouijit', 'ouijit'],
    ['git@github.com:ouijit/ouijit', 'github.com', 'ouijit', 'ouijit'],
    ['https://github.com/ouijit/ouijit.git', 'github.com', 'ouijit', 'ouijit'],
    ['https://github.com/ouijit/ouijit', 'github.com', 'ouijit', 'ouijit'],
    ['http://github.com/ouijit/ouijit/', 'github.com', 'ouijit', 'ouijit'],
    ['ssh://git@github.com/ouijit/ouijit.git', 'github.com', 'ouijit', 'ouijit'],
    ['git://github.com/ouijit/ouijit.git', 'github.com', 'ouijit', 'ouijit'],
    // Credentials in an https remote are common with credential helpers.
    ['https://someone@github.com/ouijit/ouijit.git', 'github.com', 'ouijit', 'ouijit'],
    // GitHub Enterprise is the same shapes on a different host.
    ['git@github.acme-corp.com:platform/api.git', 'github.acme-corp.com', 'platform', 'api'],
    ['https://github.acme-corp.com/platform/api.git', 'github.acme-corp.com', 'platform', 'api'],
    // The SSH alias and the www prefix must fold onto the canonical host, or
    // the same repo cloned two ways resolves to two different identities.
    ['git@ssh.github.com:ouijit/ouijit.git', 'github.com', 'ouijit', 'ouijit'],
    ['https://www.github.com/ouijit/ouijit', 'github.com', 'ouijit', 'ouijit'],
    // Case in the host is not meaningful; case in owner/repo is.
    ['git@GitHub.com:Ouijit/Ouijit.git', 'github.com', 'Ouijit', 'Ouijit'],
  ])('parses %s', (url, host, owner, repo) => {
    expect(parseRemoteUrl(url)).toEqual({ host, owner, repo });
  });

  test.each([
    ['', 'empty string'],
    ['   ', 'whitespace'],
    ['/Users/me/some/local/repo', 'a local path'],
    ['https://github.com/ouijit', 'a one-segment path'],
    ['https://github.com/ouijit/ouijit/extra/deep', 'a too-deep path'],
    ['https://gist.github.com/abc123', 'a gist'],
    ['file:///Users/me/repo.git', 'an unsupported protocol'],
  ])('rejects %s (%s)', (url) => {
    expect(parseRemoteUrl(url)).toBeNull();
  });

  test('does not treat a scp-style host as a URL scheme', () => {
    // `git@host:owner/repo` has a colon but no `//`, so URL parsing would
    // mis-read `git@host` as the protocol.
    expect(parseRemoteUrl('git@github.com:a/b')).toEqual({ host: 'github.com', owner: 'a', repo: 'b' });
  });

  test('isDotCom distinguishes github.com from Enterprise', () => {
    expect(isDotCom({ host: 'github.com', owner: 'o', repo: 'r' })).toBe(true);
    expect(isDotCom({ host: 'github.acme-corp.com', owner: 'o', repo: 'r' })).toBe(false);
  });
});

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
