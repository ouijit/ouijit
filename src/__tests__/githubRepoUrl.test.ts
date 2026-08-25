import { describe, test, expect } from 'vitest';

import { parseRemoteUrl, isDotCom, parseRepoInput, repoRef, cloneUrl } from '../github/repoUrl';
import type { RepoIdentity } from '../types';

describe('parseRepoInput', () => {
  test.each([
    ['pbjer/ouijit', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['https://github.com/pbjer/ouijit', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['https://github.com/pbjer/ouijit.git', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['git@github.com:pbjer/ouijit.git', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['ssh://git@github.com/pbjer/ouijit.git', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['  https://github.com/pbjer/ouijit/  ', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['https://github.com/pbjer/ouijit/tree/main', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['https://github.com/pbjer/ouijit/pull/12', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['https://ghe.corp.example/team/tools', { host: 'ghe.corp.example', owner: 'team', repo: 'tools' }],
  ])('resolves %s', (input, expected) => {
    expect(parseRepoInput(input)).toEqual(expected);
  });

  test.each(['', '   ', 'ouijit', 'https://github.com/pbjer', 'not a repo at all'])('rejects %j', (input) => {
    expect(parseRepoInput(input)).toBeNull();
  });

  test('builds an HTTPS clone URL from any input form', () => {
    expect(cloneUrl(parseRepoInput('git@github.com:pbjer/ouijit.git')!)).toBe('https://github.com/pbjer/ouijit.git');
  });
});

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

describe('repoRef', () => {
  test.each<[string, RepoIdentity]>([
    ['github.com', { host: 'github.com', owner: 'pbjer', repo: 'ouijit' }],
    ['an enterprise host', { host: 'ghe.corp.example', owner: 'team', repo: 'tools' }],
  ])('round-trips a repo on %s', (_label, identity) => {
    expect(parseRepoInput(repoRef(identity))).toEqual(identity);
  });

  test('keeps the host that a bare slug would lose', () => {
    const enterprise = { host: 'ghe.corp.example', owner: 'team', repo: 'tools' };
    expect(repoRef(enterprise)).toBe('https://ghe.corp.example/team/tools');
    expect(parseRepoInput('team/tools')).toEqual({ host: 'github.com', owner: 'team', repo: 'tools' });
  });
});
