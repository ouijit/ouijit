/**
 * Cloning a GitHub repository into the projects folder.
 *
 * `gh repo clone` when the CLI is there — it carries gh's credentials, so a
 * private repo works without the app touching a token — and plain `git clone`
 * over HTTPS otherwise, which covers public repos on a machine without gh.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ghEnv, probeGh } from './github/client';
import { parseRemoteUrl } from './github/repoIdentity';
import { repoSlug, type RepoIdentity } from './github/types';
import { getDefaultProjectsDir } from './projectsFolder';
import { getLogger } from './logger';
import type { CloneProjectOptions, CreateProjectResult } from './types';

const execFileAsync = promisify(execFile);

const cloneLog = getLogger().scope('repoCloner');

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

/**
 * git blocks on a credential or SSH passphrase prompt when nothing is on the
 * other end of stdin, and in a GUI process nothing ever is — the clone would
 * hang forever instead of failing. These turn both prompts into an error.
 */
function cloneEnv(identity: RepoIdentity): NodeJS.ProcessEnv {
  return {
    ...ghEnv(identity),
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  };
}

function cloneErrorMessage(stderr: string, identity: RepoIdentity): string {
  const slug = repoSlug(identity);
  // Auth first: an SSH rejection prints "Permission denied" and "Could not
  // read from remote repository" together, and only the first names the cause.
  if (/authentication|permission denied|could not read Username|HTTP 401|HTTP 403/i.test(stderr)) {
    return `GitHub refused access to ${slug}. Run \`gh auth login\` in a terminal.`;
  }
  if (/not found|could not resolve to a|could not read from remote|HTTP 404/i.test(stderr)) {
    return `${slug} was not found. Check the name, or run \`gh auth login\` if it is private.`;
  }
  if (/could not resolve host|network is unreachable|connection refused|ETIMEDOUT/i.test(stderr)) {
    return 'Could not reach GitHub.';
  }
  if (/ENOENT/.test(stderr)) {
    return 'Git is required. Install via `xcode-select --install` (macOS) or your package manager (Linux).';
  }
  return (
    stderr
      .split('\n')
      .find((line) => line.trim())
      ?.trim() || `Could not clone ${slug}.`
  );
}

/** Clone into `<parentDir>/<repo name>`, leaving no folder behind on failure. */
export async function cloneRepository(options: CloneProjectOptions): Promise<CreateProjectResult> {
  const identity = parseRepoInput(options.repo);
  if (!identity) return { success: false, error: 'Enter a repository as owner/name, or paste its GitHub URL' };

  const parentDir = options.parentDir ?? (await getDefaultProjectsDir());
  if (!path.isAbsolute(parentDir)) {
    return { success: false, error: 'The project location must be an absolute path' };
  }
  const projectPath = path.join(parentDir, identity.repo);
  if (!path.resolve(projectPath).startsWith(path.resolve(parentDir) + path.sep)) {
    return { success: false, error: 'Invalid repository name' };
  }

  try {
    await fs.access(projectPath);
    return { success: false, error: `A folder named ${identity.repo} already exists in that location` };
  } catch {
    // Nothing there, which is what we want.
  }

  await fs.mkdir(parentDir, { recursive: true });

  const { installed } = await probeGh();
  const [command, args] = installed
    ? (['gh', ['repo', 'clone', repoSlug(identity), projectPath]] as const)
    : (['git', ['clone', cloneUrl(identity), projectPath]] as const);

  try {
    await execFileAsync(command, args, { env: cloneEnv(identity), maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const stderr = err.stderr || err.message || '';
    cloneLog.warn('clone failed', { slug: repoSlug(identity), command, stderr: stderr.slice(0, 500) });
    // A failed clone can leave a partial checkout behind, and the caller is
    // about to be told nothing was created.
    await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
    return { success: false, error: cloneErrorMessage(stderr, identity) };
  }

  return { success: true, projectPath };
}
