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

/**
 * nono's config root. Mirrors nono's own resolution (`resolve_user_config_dir`
 * in nono-cli): `$XDG_CONFIG_HOME` when set to an absolute path, else
 * `~/.config`, plus `/nono`. nono does NOT read a `$NONO_CONFIG` env var for
 * this (that name is only a wiring expansion variable), so Ouijit must not
 * honor one either — writing profiles under a root nono never reads makes
 * every sandboxed spawn fail profile resolution.
 */
function nonoConfigRoot(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'nono');
}

let ensured: Promise<void> | undefined;

/**
 * Ensure the union profile is installed and resolvable before a nono spawn:
 * install any missing agent packs it inherits, then write the profile JSON to
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

/**
 * Install (or refresh) the union profile and the agent packs it inherits.
 * Exported for tests; runtime callers go through the memoized
 * `ensureUnionProfile`.
 */
export async function installUnionProfile(nonoPath: string): Promise<void> {
  const root = nonoConfigRoot();
  await ensurePacks(nonoPath, root);
  await writeProfile(root);
}

/**
 * The two fields of nono's `packages/lockfile.json` Ouijit reads. Pack entries
 * are relocated opaquely (nono owns their shape); the only field Ouijit
 * touches inside an entry is `wiring_record`.
 */
interface NonoLockfile {
  lockfile_version: number;
  registry?: string;
  packages: Record<string, Record<string, unknown>>;
}

/**
 * Read a nono lockfile. `lockfile` is null when the file is absent (normal on
 * a fresh machine — nono treats a missing lockfile as empty) or when it is
 * corrupt. `corrupt` distinguishes the two: nono hard-errors on a lockfile it
 * cannot parse (including valid JSON of the wrong shape or one missing the
 * required `lockfile_version`), which blocks `nono pull` itself — so a corrupt
 * file must be rewritten, not just ignored.
 */
async function readLockfile(file: string): Promise<{ lockfile: NonoLockfile | null; corrupt: boolean }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { lockfile: null, corrupt: false };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    // nono requires lockfile_version (no serde default) and packages must be
    // an object; anything else is as fatal to nono as unparseable JSON.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('lockfile is not a JSON object');
    }
    const candidate = parsed as NonoLockfile;
    if (typeof candidate.lockfile_version !== 'number') {
      throw new Error('lockfile has no numeric lockfile_version');
    }
    const packages = candidate.packages;
    if (packages !== undefined && (typeof packages !== 'object' || packages === null || Array.isArray(packages))) {
      throw new Error('lockfile packages is not an object');
    }
    return { lockfile: { ...candidate, packages: packages ?? {} }, corrupt: false };
  } catch (error) {
    nonoLog.warn('corrupt nono lockfile; it will be rewritten', {
      file,
      error: error instanceof Error ? error.message : String(error),
    });
    return { lockfile: null, corrupt: true };
  }
}

/** Write a lockfile atomically (tmp + rename), matching nono's own writer. */
async function writeLockfile(file: string, lockfile: NonoLockfile): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Distinct suffix from nono's own `lockfile.json.tmp` so a concurrent
  // `nono pull` can't collide with this write.
  const tmp = `${file}.ouijit-tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(lockfile, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

/**
 * Ensure every inherited agent pack is installed under the config root.
 *
 * "Installed" means the pack directory exists AND `packages/lockfile.json`
 * has an entry for it — nono's `verify_profile_packs` hard-errors on every
 * real `nono run` when a pack directory has no lockfile entry, and profile
 * resolution fails when the directory itself is missing. A bare directory
 * copy is therefore never sufficient.
 *
 * Missing packs are installed as a matched pair from the tree Ouijit bundles
 * under `share/nono/packages` (the pack directory plus its vendored lockfile
 * entry, merged into the runtime lockfile), so the first sandboxed spawn
 * needs no network. The vendored entry is the verbatim output of a real
 * `nono pull` at vendor time — artifact digests and the Sigstore trust bundle
 * still verify offline against nono's compiled-in root. Only when no bundled
 * copy exists (dev / unpackaged builds) does this fall back to pulling from
 * nono's registry. Packs are platform-independent JSON, so the bundled tree
 * is valid on every OS.
 */
async function ensurePacks(nonoPath: string, root: string): Promise<void> {
  const packagesDir = path.join(root, 'packages');
  const lockfilePath = path.join(packagesDir, 'lockfile.json');
  const { lockfile, corrupt } = await readLockfile(lockfilePath);

  const missing: string[] = [];
  for (const pack of PROFILE_PACKAGES) {
    const locked = lockfile?.packages[pack] !== undefined;
    if (!locked || !(await pathExists(path.join(packagesDir, pack)))) missing.push(pack);
  }
  if (missing.length === 0) return;

  const bundled = resolveBundledResourceDir('share', 'nono', 'packages');
  const bundledLockfile = bundled ? (await readLockfile(path.join(bundled, 'lockfile.json'))).lockfile : null;

  // Merge vendored entries into the user's existing lockfile (never clobber
  // packs they pulled themselves). When creating it fresh, inherit the
  // version/registry from the vendored file, which came from the same pinned
  // nono binary Ouijit ships; without one (dev builds healing a corrupt file),
  // fall back to the pinned binary's LOCKFILE_VERSION — nono never validates
  // the number beyond bumping 0, so any real version parses fine.
  const merged: NonoLockfile = lockfile ?? {
    lockfile_version: bundledLockfile?.lockfile_version ?? 4,
    registry: bundledLockfile?.registry,
    packages: {},
  };

  let mergedDirty = false;
  const toPull: string[] = [];
  for (const pack of missing) {
    const entry = bundledLockfile?.packages[pack];
    const bundledPack = bundled ? path.join(bundled, pack) : null;
    if (!entry || !bundledPack || !(await pathExists(bundledPack))) {
      toPull.push(pack);
      continue;
    }
    nonoLog.info('installing bundled nono agent pack', { pack });
    const dest = path.join(packagesDir, pack);
    // Replace any stale directory so the files always match the entry's
    // digests — a mismatched pair fails nono's tamper check.
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(bundledPack, dest, { recursive: true });
    // The copy performs none of `nono pull`'s wiring, so an empty record is
    // the honest state (verify never reads it).
    merged.packages[pack] = { ...entry, wiring_record: [] };
    mergedDirty = true;
  }

  // Write before any pulls: `nono pull` reads and rewrites the lockfile
  // itself, so it must see the merged entries rather than race them. A corrupt
  // file is rewritten even with nothing merged — `nono pull` hard-errors on a
  // lockfile it cannot parse, so leaving it in place would block the fallback.
  if (mergedDirty || corrupt) await writeLockfile(lockfilePath, merged);

  for (const pack of toPull) {
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
