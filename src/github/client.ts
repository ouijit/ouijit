/**
 * The `gh` CLI wrapper.
 *
 * Everything GitHub goes through here, in the same execFile idiom as git.ts.
 * Auth is entirely `gh`'s problem: we never read, store, or forward a token,
 * so there is no secret-storage surface anywhere in the app.
 *
 * Two entry points — one REST helper and one GraphQL helper. GraphQL is not
 * optional: resolving a review thread and reading `statusCheckRollup` have no
 * REST equivalent.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '../logger';
import { isDotCom } from './repoIdentity';
import type { RepoIdentity } from './types';

const execFileAsync = promisify(execFile);

const ghLog = getLogger().scope('github');

/**
 * `gh api --slurp`, which paginated reads depend on, first shipped in 2.48.0.
 * Below that the version gate used to pass and then the file list would die
 * with `unknown flag: --slurp`, silently degrading every pull request to the
 * git file list. Anything older gets told to upgrade instead.
 */
export const MIN_GH_VERSION = '2.48.0';

/** A busy inbox must not fork twenty `gh` processes at once. */
const MAX_CONCURRENT = 4;

/** gh's own default is 30s; PR detail on a large repo can legitimately take longer. */
const GH_TIMEOUT_MS = 45_000;

export type GithubErrorKind =
  | 'not-found'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'network'
  | 'gh-missing'
  | 'unknown';

export class GithubError extends Error {
  constructor(
    public kind: GithubErrorKind,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

// ── Concurrency gate ─────────────────────────────────────────────────

let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = waiting.shift();
    if (next) next();
  }
}

// ── Error mapping ────────────────────────────────────────────────────

/**
 * Turn gh's stderr into something the panel can show. gh writes HTTP failures
 * as `gh: <message> (HTTP 404)`, so the status is recoverable from the text
 * without parsing the JSON body.
 */
export function classifyGhError(stderr: string, code?: number): GithubError {
  const text = stderr.trim();

  if (/rate limit|secondary rate|abuse detection/i.test(text)) {
    return new GithubError(
      'rate-limited',
      'GitHub rate limit reached. This limit is shared with every tool using your token.',
      text,
    );
  }
  if (/HTTP 401|Bad credentials|authentication|gh auth login/i.test(text)) {
    return new GithubError('unauthorized', 'GitHub rejected the credentials. Run `gh auth login`.', text);
  }
  if (/HTTP 403|Resource not accessible|must have admin/i.test(text)) {
    return new GithubError('forbidden', 'Your GitHub token lacks permission for this action.', text);
  }
  if (/HTTP 404|Not Found|Could not resolve to a/i.test(text)) {
    return new GithubError('not-found', 'GitHub returned 404 for that resource.', text);
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|dial tcp|network is unreachable/i.test(text)) {
    return new GithubError('network', 'Could not reach GitHub.', text);
  }
  if (code === 127 || /ENOENT/.test(text)) {
    return new GithubError('gh-missing', 'The `gh` CLI is not installed or not on PATH.', text);
  }
  return new GithubError('unknown', firstLine(text) || 'gh command failed', text);
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((l) => l.trim())
      ?.replace(/^gh:\s*/, '')
      .trim() ?? ''
  );
}

// ── Raw exec ─────────────────────────────────────────────────────────

interface ExecOptions {
  /** Repo the command targets — sets GH_HOST for Enterprise. */
  identity?: RepoIdentity;
  /** cwd for the child; gh reads repo context from it when no --repo is given. */
  cwd?: string;
  /** Written to the child's stdin (used for review bodies with newlines). */
  input?: string;
  maxBuffer?: number;
}

/**
 * Build the child env. `GH_HOST` is what points gh at an Enterprise instance;
 * `GH_PROMPT_DISABLED` and `GH_NO_UPDATE_NOTIFIER` keep gh from ever blocking
 * on a TTY prompt or writing an upgrade banner into stdout we then try to
 * parse as JSON.
 */
function ghEnv(identity?: RepoIdentity): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    CLICOLOR: '0',
    NO_COLOR: '1',
  };
  if (identity && !isDotCom(identity)) env.GH_HOST = identity.host;
  return env;
}

/** Run `gh` with the given argv and return stdout. Throws GithubError. */
export async function runGh(args: string[], options: ExecOptions = {}): Promise<string> {
  return withSlot(async () => {
    try {
      const child = execFileAsync('gh', args, {
        cwd: options.cwd,
        env: ghEnv(options.identity),
        encoding: 'utf8',
        maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
        timeout: GH_TIMEOUT_MS,
      });
      if (options.input != null) {
        child.child.stdin?.end(options.input);
      }
      const { stdout } = await child;
      return stdout;
    } catch (error) {
      const err = error as { stderr?: string; message?: string; code?: number };
      const ghError = classifyGhError(err.stderr || err.message || '', err.code);
      ghLog.warn('gh failed', { args: redactArgs(args), kind: ghError.kind, message: ghError.message });
      throw ghError;
    }
  });
}

/** Comment bodies can be long and personal; keep them out of the log. */
function redactArgs(args: string[]): string[] {
  return args.map((arg) => (arg.length > 120 ? `${arg.slice(0, 40)}…` : arg));
}

// ── REST ─────────────────────────────────────────────────────────────

export interface RestOptions extends ExecOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body. Sent via `--input -` so nothing has to survive shell quoting. */
  body?: unknown;
  /** Follow pagination and concatenate the arrays. */
  paginate?: boolean;
}

/**
 * `gh api <path>` with a JSON response.
 *
 * `path` is the API path without a leading slash, e.g.
 * `repos/o/r/pulls/12/files`.
 */
export async function ghRest<T>(path: string, options: RestOptions = {}): Promise<T> {
  const parsed = parseJson<T>(await ghRestRaw(path, options), path);
  // --slurp wraps each page in an outer array; flatten so callers see one list.
  if (options.paginate && Array.isArray(parsed)) {
    return (parsed as unknown[]).flat() as T;
  }
  return parsed;
}

/**
 * A REST call whose success is the absence of an error.
 *
 * A DELETE answers 204 with an empty body, which `ghRest` would reject as
 * unparseable — the empty response is the success, not a malformed one.
 */
export async function ghRestVoid(path: string, options: RestOptions = {}): Promise<void> {
  await ghRestRaw(path, options);
}

async function ghRestRaw(path: string, options: RestOptions): Promise<string> {
  const args = ['api', path];
  if (options.method && options.method !== 'GET') args.push('--method', options.method);
  if (options.paginate) args.push('--paginate', '--slurp');
  if (options.body !== undefined) args.push('--input', '-');

  return runGh(args, {
    ...options,
    input: options.body !== undefined ? JSON.stringify(options.body) : options.input,
  });
}

// ── GraphQL ──────────────────────────────────────────────────────────

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; type?: string }>;
}

/**
 * `gh api graphql`. Variables go through `-F name=value` (typed) rather than
 * being interpolated into the query, so a branch name with a quote in it can't
 * break the document.
 */
export async function ghGraphql<T>(
  query: string,
  variables: Record<string, string | number | boolean> = {},
  options: ExecOptions = {},
): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    // -f sends strings, -F infers numbers/booleans. Using -F for a string that
    // happens to look numeric (a branch called "2") would send it as an Int and
    // fail the schema check, so strings always go through -f.
    args.push(typeof value === 'string' ? '-f' : '-F', `${key}=${value}`);
  }

  const raw = await runGh(args, options);
  const response = parseJson<GraphqlResponse<T>>(raw, 'graphql');

  if (response.errors?.length) {
    const message = response.errors.map((e) => e.message).join('; ');
    // GraphQL reports a missing repo/PR as a 200 with an errors array rather
    // than a 404, so the kind has to be recovered from the message.
    const kind: GithubErrorKind = /Could not resolve to|NOT_FOUND/i.test(message)
      ? 'not-found'
      : /rate limit/i.test(message)
        ? 'rate-limited'
        : 'unknown';
    throw new GithubError(kind, message);
  }
  if (!response.data) throw new GithubError('unknown', 'GitHub returned an empty GraphQL response');
  return response.data;
}

function parseJson<T>(raw: string, context: string): T {
  const trimmed = raw.trim();
  if (!trimmed) throw new GithubError('unknown', `gh returned no output for ${context}`);
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new GithubError('unknown', `gh returned unparseable output for ${context}`, trimmed.slice(0, 500));
  }
}

// ── Availability probes ──────────────────────────────────────────────

/** Parse `gh version 2.85.0 (…)`. */
export function parseGhVersion(stdout: string): string | null {
  const match = /gh version (\d+\.\d+\.\d+)/.exec(stdout);
  return match?.[1] ?? null;
}

/** True when `version` is at least `minimum`. Both are plain X.Y.Z. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

export interface GhProbe {
  installed: boolean;
  version?: string;
  /** False when gh is present but below MIN_GH_VERSION. */
  versionOk: boolean;
  authenticated: boolean;
}

/**
 * Detect gh and whether it holds credentials. Runs the two probes in parallel;
 * `gh auth status` exits non-zero when logged out, which is the signal rather
 * than an error.
 */
export async function probeGh(): Promise<GhProbe> {
  let version: string | undefined;
  let installed = false;
  try {
    const { stdout } = await execFileAsync('gh', ['--version'], { encoding: 'utf8', timeout: 10_000 });
    installed = true;
    version = parseGhVersion(stdout) ?? undefined;
  } catch {
    return { installed: false, versionOk: false, authenticated: false };
  }

  let authenticated = false;
  try {
    await execFileAsync('gh', ['auth', 'status'], {
      encoding: 'utf8',
      env: ghEnv(),
      timeout: 15_000,
    });
    authenticated = true;
  } catch {
    authenticated = false;
  }

  return {
    installed,
    version,
    versionOk: version ? versionAtLeast(version, MIN_GH_VERSION) : false,
    authenticated,
  };
}

/** Login of the authenticated user, or null when gh can't tell us. */
export async function getViewerLogin(identity?: RepoIdentity): Promise<string | null> {
  try {
    const raw = await runGh(['api', 'user', '--jq', '.login'], { identity });
    return raw.trim() || null;
  } catch {
    return null;
  }
}

/** Test seam — resets the concurrency gate between cases. */
export function _resetConcurrencyForTesting(): void {
  active = 0;
  waiting.length = 0;
}
