import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '../../logger';
import { resolveBundledResourceDir } from '../../paths';

const execFileAsync = promisify(execFile);
const nonoLog = getLogger().scope('nono');

/** The name Ouijit's composed profile resolves under (`nono run --profile ouijit`). */
export const OUIJIT_PROFILE_NAME = 'ouijit';

/**
 * nono agent packs the union profile inherits from. Every supported agent's
 * profile is unioned so any of them authenticates and runs under one profile,
 * with no per-task opt-in. These must be pulled from the registry before the
 * profile resolves; `ensureUnionProfile` pulls any that are missing.
 */
const PROFILE_PACKAGES = [
  'always-further/claude',
  'always-further/codex',
  'always-further/opencode',
  'always-further/pi',
] as const;

/**
 * Ouijit's composed sandbox profile. `extends` unions nono's per-agent packs
 * (filesystem grants, runtime groups, keychain access) so a task shell can run
 * any supported agent and authenticate through the OS keychain. `open_urls` is
 * the one field nono does not union across parents (it replaces rather than
 * appends), so the OAuth origins of all four agents are merged here explicitly.
 *
 * Per-task grants (the worktree, the repo's git dir, the hook-server port) are
 * NOT in the profile — those are layered on as `nono run` flags at spawn time,
 * since they differ per task. This file is only the static, agent-facing half.
 */
const UNION_PROFILE = {
  meta: {
    name: OUIJIT_PROFILE_NAME,
    description:
      'Ouijit task sandbox: unions nono per-agent profiles (claude, codex, opencode, pi) so any supported agent ' +
      'authenticates and runs in place on a task worktree. Ouijit layers the worktree and git grants on top at spawn time.',
  },
  extends: ['default', ...PROFILE_PACKAGES],
  workdir: { access: 'readwrite' },
  open_urls: {
    allow_origins: [
      'https://claude.ai',
      'https://claude.com',
      'https://api.anthropic.com',
      'https://platform.claude.com',
      'https://auth.openai.com',
      'https://github.com',
    ],
    allow_localhost: true,
  },
} as const;

/** nono's config root: `$NONO_CONFIG`, else `$XDG_CONFIG_HOME/nono`, else `~/.config/nono`. */
function nonoConfigRoot(): string {
  if (process.env.NONO_CONFIG) return process.env.NONO_CONFIG;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'nono');
}

let ensured: Promise<void> | undefined;

/**
 * Ensure the union profile is installed and resolvable before a nono spawn:
 * pull any missing agent packs it inherits, then write the profile JSON to
 * nono's profiles dir. Memoized per process — the first spawn pays the cost,
 * the rest reuse it. Rethrows on failure so `prepare` surfaces a clear reason
 * and clears the memo so a transient failure can be retried on the next spawn.
 */
export function ensureUnionProfile(nonoPath: string): Promise<void> {
  if (!ensured) {
    ensured = installUnionProfile(nonoPath).catch((error) => {
      ensured = undefined;
      throw error;
    });
  }
  return ensured;
}

async function installUnionProfile(nonoPath: string): Promise<void> {
  const root = nonoConfigRoot();
  await ensurePacks(nonoPath, root);
  await writeProfile(root);
}

/**
 * Ensure every inherited agent pack is present under the config root. Missing
 * packs are installed from the copy Ouijit bundles under `share/nono/packages`
 * so the first sandboxed spawn needs no network; only when no bundled copy
 * exists (dev / unpackaged builds) does it fall back to pulling from nono's
 * registry. Packs are platform-independent JSON, so the bundled tree is valid
 * on every OS.
 */
async function ensurePacks(nonoPath: string, root: string): Promise<void> {
  const packagesDir = path.join(root, 'packages');
  const missing: string[] = [];
  for (const pack of PROFILE_PACKAGES) {
    try {
      await fs.access(path.join(packagesDir, pack));
    } catch {
      missing.push(pack);
    }
  }
  if (missing.length === 0) return;

  const bundled = resolveBundledResourceDir('share', 'nono', 'packages');
  for (const pack of missing) {
    const dest = path.join(packagesDir, pack);
    const bundledPack = bundled ? path.join(bundled, pack) : null;
    if (bundledPack && (await pathExists(bundledPack))) {
      nonoLog.info('installing bundled nono agent pack', { pack });
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.cp(bundledPack, dest, { recursive: true });
      continue;
    }
    nonoLog.info('pulling nono agent pack for the union profile', { pack });
    try {
      await execFileAsync(nonoPath, ['pull', pack]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nonoLog.error('failed to pull nono agent pack', { pack, error: message });
      throw new Error(`Could not install the nono agent profile '${pack}' (needed for sandboxing): ${message}`);
    }
  }
}

/** Whether a path exists, without throwing. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Deterministic per-project profile name for a developer's override profile. */
export function projectProfileName(projectPath: string): string {
  const hash = createHash('sha1').update(projectPath).digest('hex').slice(0, 10);
  return `${OUIJIT_PROFILE_NAME}-${hash}`;
}

/**
 * Resolve the profile a spawn runs under. With no override, the managed
 * `ouijit` profile. With an override (the profile editor), write the
 * developer's raw profile JSON to a per-project profile file and return its
 * name so `nono run --profile` resolves it. `meta.name` is forced to the
 * filename so a hand-edited profile can't drift from the name we pass. Invalid
 * JSON falls back to the managed profile (logged) rather than blocking the
 * spawn — the editor surfaces parse errors separately at save time.
 */
export async function ensureProjectProfile(projectPath: string, override: string | undefined): Promise<string> {
  if (!override || override.trim().length === 0) return OUIJIT_PROFILE_NAME;
  const name = projectProfileName(projectPath);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(override) as Record<string, unknown>;
  } catch (error) {
    nonoLog.warn('invalid nono profile override; falling back to the managed profile', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return OUIJIT_PROFILE_NAME;
  }
  const meta = typeof parsed.meta === 'object' && parsed.meta !== null ? (parsed.meta as Record<string, unknown>) : {};
  const withName = { ...parsed, meta: { ...meta, name } };
  const profilesDir = path.join(nonoConfigRoot(), 'profiles');
  await fs.mkdir(profilesDir, { recursive: true });
  await fs.writeFile(path.join(profilesDir, `${name}.json`), `${JSON.stringify(withName, null, 2)}\n`, 'utf8');
  return name;
}

/** Write the union profile JSON, skipping the write when the file already matches. */
async function writeProfile(root: string): Promise<void> {
  const profilesDir = path.join(root, 'profiles');
  const file = path.join(profilesDir, `${OUIJIT_PROFILE_NAME}.json`);
  const desired = `${JSON.stringify(UNION_PROFILE, null, 2)}\n`;

  try {
    if ((await fs.readFile(file, 'utf8')) === desired) return;
  } catch {
    // Absent or unreadable — fall through and (re)write it.
  }
  await fs.mkdir(profilesDir, { recursive: true });
  await fs.writeFile(file, desired, 'utf8');
  nonoLog.info('wrote nono union profile', { file });
}
