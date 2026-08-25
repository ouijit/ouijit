/**
 * Parsing a GitHub repo out of a remote URL or out of what a person typed.
 *
 * A runtime leaf — no git, no subprocess — so the renderer can validate the
 * import dialog's input with the exact parser the clone will use, instead of
 * an approximation that disagrees with it.
 */

import type { RepoIdentity } from './types';

/**
 * Parse a git remote URL into `{host, owner, repo}`.
 *
 * Handles the three forms a GitHub remote realistically takes — scp-style SSH
 * (`git@github.com:o/r.git`), ssh:// URLs, and https:// URLs — plus GitHub
 * Enterprise hosts, which are the same shapes on a different domain. Returns
 * null for anything that isn't a two-segment owner/repo path (gists, other
 * forges, local paths).
 */
export function parseRemoteUrl(url: string): RepoIdentity | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // scp-style: [user@]host:owner/repo[.git]
  const scp = /^(?:([^@/]+)@)?([^/:]+):(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes('://')) {
    return fromHostAndPath(scp[2], scp[3]);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!['ssh:', 'git:', 'http:', 'https:'].includes(parsed.protocol)) return null;
  return fromHostAndPath(parsed.hostname, parsed.pathname);
}

function fromHostAndPath(host: string, rawPath: string): RepoIdentity | null {
  const segments = rawPath
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length !== 2) return null;
  const [owner, repo] = segments;
  if (!owner || !repo) return null;
  return { host: normalizeHost(host), owner, repo };
}

/**
 * Fold the SSH alias and the www prefix onto the canonical host so a repo
 * cloned over SSH and the same repo cloned over HTTPS resolve identically.
 */
function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  if (lower === 'ssh.github.com') return 'github.com';
  if (lower === 'www.github.com') return 'github.com';
  return lower;
}

/** True for github.com itself; anything else with a GitHub remote is GHES. */
export function isDotCom(identity: RepoIdentity): boolean {
  return identity.host === 'github.com';
}

/** `owner/name` with no scheme — the shorthand `gh` itself accepts. */
const SHORTHAND = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

/**
 * Resolve what a person typed into a repo. Accepts the `owner/name` shorthand
 * and every URL form `parseRemoteUrl` handles, plus the URL a browser is
 * showing when they copy it — which carries a page path (`/tree/main`,
 * `/pull/12`) past `owner/name` that `parseRemoteUrl` alone rejects.
 */
export function parseRepoInput(input: string): RepoIdentity | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (SHORTHAND.test(trimmed)) return parseRemoteUrl(`https://github.com/${trimmed}`);

  const direct = parseRemoteUrl(trimmed);
  if (direct) return direct;

  try {
    const url = new URL(trimmed);
    const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
    if (owner && repo) return parseRemoteUrl(`${url.protocol}//${url.host}/${owner}/${repo}`);
  } catch {
    /* not a URL either */
  }
  return null;
}

export function cloneUrl(identity: RepoIdentity): string {
  return `https://${identity.host}/${identity.owner}/${identity.repo}.git`;
}
