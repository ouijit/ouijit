/**
 * Cloning a GitHub repository into the projects folder.
 *
 * `gh repo clone` when the CLI is there — it carries gh's credentials, so a
 * private repo works without the app touching a token — and plain `git clone`
 * over HTTPS otherwise, which covers public repos on a machine without gh.
 *
 * The clone streams rather than resolving once: a large repo takes minutes, so
 * the caller has to be able to show progress and cancel instead of blocking on
 * a subprocess.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ghEnv } from './github/client';
import { cloneUrl } from './github/repoUrl';
import { repoSlug, type RepoIdentity } from './github/types';
import { getCachedHealth, checkHealth } from './healthCheck';
import { resolveNewProjectPath, type NewProjectPathFailure } from './projectCreator';
import { getLogger } from './logger';
import type { CloneProgress, CloneProjectOptions } from './types';

const cloneLog = getLogger().scope('repoCloner');

/** Enough of git's stderr to diagnose a failure, without holding a whole log. */
const STDERR_TAIL = 8 * 1024;

/** How long the last of stderr gets to arrive after the process is gone. */
const EXIT_GRACE_MS = 250;

/** How long a signalled process group gets before it is killed outright. */
const KILL_GRACE_MS = 2_000;

const MEASURED = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+(\d+)%\s+\(\d+\/\d+\)(.*)$/;
const UNMEASURED = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+\d+(?:$|,)/;

/**
 * One line of git's progress, or null for a line that carries none.
 *
 * git only writes progress to a non-TTY when asked with `--progress`, and
 * redraws each step in place with a carriage return rather than a newline, so
 * the reader has to split on `\r` as well as `\n` to see the updates.
 */
export function parseCloneProgress(line: string): CloneProgress | null {
  const trimmed = line.trim();

  const measured = MEASURED.exec(trimmed);
  if (measured) {
    const detail = measured[3]
      .replace(/^,\s*/, '')
      .replace(/,?\s*done\.$/, '')
      .trim();
    return { phase: measured[1], percent: Number(measured[2]), detail: detail || null };
  }

  const unmeasured = UNMEASURED.exec(trimmed);
  if (unmeasured) return { phase: unmeasured[1], percent: null, detail: null };

  return null;
}

/** Where a clone will land, and where it runs while it is still arriving. */
export interface CloneTarget {
  identity: RepoIdentity;
  projectPath: string;
  /**
   * A sibling of `projectPath`, so the rename into place stays within one
   * filesystem and is therefore atomic. The destination never exists
   * half-cloned, and abandoning a clone is one directory removal.
   */
  stagingPath: string;
}

export type CloneOutcome = { status: 'landed' } | { status: 'canceled' } | { status: 'failed'; error: string };

export type ResolvedCloneTarget = { ok: true; target: CloneTarget } | { ok: false; error: string };

const CLONE_PATH_ERRORS: Record<NewProjectPathFailure, (name: string) => string> = {
  'relative-parent': () => 'The project location must be an absolute path',
  'escapes-parent': () => 'Invalid repository name',
  taken: (name) => `A folder named ${name} already exists in that location`,
};

export async function resolveCloneTarget(options: CloneProjectOptions): Promise<ResolvedCloneTarget> {
  const { repo: identity } = options;
  const resolved = await resolveNewProjectPath(identity.repo, options.parentDir);
  if (resolved.ok === false) return { ok: false, error: CLONE_PATH_ERRORS[resolved.reason](identity.repo) };

  const { parentDir, projectPath } = resolved;
  return {
    ok: true,
    target: { identity, projectPath, stagingPath: path.join(parentDir, `.${identity.repo}.cloning`) },
  };
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
  // The last line, not the first: git leads with the progress it had already
  // drawn and puts what actually went wrong at the end.
  return (
    stderr
      .split('\n')
      .findLast((line) => line.trim())
      ?.trim() || `Could not clone ${slug}.`
  );
}

export interface RunningClone {
  done: Promise<CloneOutcome>;
  cancel: () => void;
  /** git's stderr, for a failure the message alone does not explain. */
  output: () => string;
}

/** Clone into the staging directory, then rename it into place. */
export function runClone(target: CloneTarget, onProgress: (progress: CloneProgress) => void): RunningClone {
  let child: ChildProcess | null = null;
  let canceled = false;
  let tail = '';

  const abandon = async () => {
    await fs.rm(target.stagingPath, { recursive: true, force: true }).catch((error) => {
      cloneLog.warn('could not remove staging directory', { path: target.stagingPath, error: String(error) });
    });
  };

  const done = (async (): Promise<CloneOutcome> => {
    // A run killed before it could clean up leaves this behind, and git
    // refuses to clone into a directory that is not empty.
    await abandon();
    await fs.mkdir(path.dirname(target.stagingPath), { recursive: true });
    if (canceled) return { status: 'canceled' };

    const gh = getCachedHealth()?.gh ?? (await checkHealth()).gh;
    const [command, args] = gh
      ? (['gh', ['repo', 'clone', repoSlug(target.identity), target.stagingPath, '--', '--progress']] as const)
      : (['git', ['clone', '--progress', cloneUrl(target.identity), target.stagingPath]] as const);

    const code = await new Promise<number | null>((resolve, reject) => {
      child = spawn(command, [...args], { env: cloneEnv(target.identity), detached: true });
      let carry = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        tail = (tail + chunk).slice(-STDERR_TAIL);
        carry += chunk;
        const lines = carry.split(/\r\n|[\r\n]/);
        carry = lines.pop() ?? '';
        for (const line of lines) {
          const progress = parseCloneProgress(line);
          if (progress) onProgress(progress);
        }
      });

      // `close` waits for every process holding the inherited stdio to exit,
      // and git's transport helper outlives the process we spawned — after a
      // cancel it can hold the pipe open for as long as the download would
      // have taken. `exit` is the event that always arrives; the grace period
      // is only there so the last of stderr lands before a failure is read.
      let settled = false;
      let grace: NodeJS.Timeout | undefined;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(grace);
        resolve(value);
      };
      child.on('error', reject);
      child.on('close', finish);
      child.on('exit', (value) => {
        grace = setTimeout(() => finish(value), EXIT_GRACE_MS);
      });
    });

    if (canceled) {
      await abandon();
      return { status: 'canceled' };
    }
    if (code !== 0) {
      cloneLog.warn('clone failed', { slug: repoSlug(target.identity), code, stderr: tail.slice(-500) });
      await abandon();
      return { status: 'failed', error: cloneErrorMessage(tail, target.identity) };
    }

    await fs.rename(target.stagingPath, target.projectPath);
    return { status: 'landed' };
  })().catch(async (error): Promise<CloneOutcome> => {
    await abandon();
    const message = error instanceof Error ? error.message : String(error);
    cloneLog.error('clone errored', { slug: repoSlug(target.identity), error: message });
    return { status: 'failed', error: cloneErrorMessage(message, target.identity) };
  });

  const cancel = () => {
    canceled = true;
    if (!child?.pid) return;
    // The negative pid signals the process group: git forks a transport helper
    // (`git-remote-https`) that keeps downloading after its parent is gone.
    const { pid } = child;
    const signal = (name: NodeJS.Signals) => {
      try {
        process.kill(-pid, name);
      } catch {
        // Already exited.
      }
    };
    signal('SIGTERM');
    // A helper mid-transfer does not always take the hint.
    setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS).unref();
  };

  return { done, cancel, output: () => tail };
}
