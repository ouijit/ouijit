import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { installUnionProfile } from '../sandbox/nono/profile';

// Intercept `nono pull` (the registry fallback) and the bundled-resources
// lookup; everything else (lockfile merge, pack copies, profile write) runs
// against real files in per-test temp dirs.
const execFileMock = vi.hoisted(() =>
  vi.fn<(file: string, args: string[], cb: (err: Error | null, stdout?: string) => void) => void>(),
);
const resolveBundledResourceDir = vi.hoisted(() => vi.fn<(...segments: string[]) => string | null>());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));
vi.mock('../paths', () => ({
  resolveBundledResourceDir: (...segments: string[]) => resolveBundledResourceDir(...segments),
}));

const PACKS = [
  'always-further/claude',
  'always-further/codex',
  'always-further/opencode',
  'always-further/pi',
] as const;
const NONO = '/opt/bin/nono';

let configBase: string; // stands in for $XDG_CONFIG_HOME
let bundledDir: string; // stands in for <resources>/share/nono/packages
let savedXdg: string | undefined;

/** The runtime lockfile installUnionProfile reads and merges. */
function runtimeLockfilePath(): string {
  return path.join(configBase, 'nono', 'packages', 'lockfile.json');
}

async function readRuntimeLockfile(): Promise<{
  lockfile_version: number;
  registry?: string;
  packages: Record<string, Record<string, unknown>>;
}> {
  return JSON.parse(await fs.readFile(runtimeLockfilePath(), 'utf8'));
}

/**
 * Write a vendored bundled tree: one dir per pack plus a lockfile whose
 * entries carry vendor-machine wiring records (which the install must strip).
 */
async function writeBundledFixture(): Promise<void> {
  const packages: Record<string, unknown> = {};
  for (const pack of PACKS) {
    const packDir = path.join(bundledDir, pack);
    await fs.mkdir(packDir, { recursive: true });
    await fs.writeFile(path.join(packDir, 'package.json'), `{"name":"${pack}"}\n`, 'utf8');
    packages[pack] = {
      version: '0.0.1',
      installed_at: '2026-01-01T00:00:00Z',
      pinned: false,
      provenance: { signer_identity: 'https://github.com/always-further/nono-packs/.github/workflows/x.yml@tag' },
      artifacts: { 'package.json': { sha256: 'abc', type: 'plugin' } },
      wiring_record: [{ type: 'write_file', dest: '/vendor/machine/only/path' }],
    };
  }
  await fs.writeFile(
    path.join(bundledDir, 'lockfile.json'),
    JSON.stringify({ lockfile_version: 4, registry: 'https://registry.nono.sh', packages }, null, 2),
    'utf8',
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  configBase = await fs.mkdtemp(path.join(os.tmpdir(), 'nono-config-'));
  bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nono-bundled-'));
  savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configBase;
  resolveBundledResourceDir.mockReturnValue(bundledDir);
  execFileMock.mockImplementation((_file, _args, cb) => cb(null, ''));
});

afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  await fs.rm(configBase, { recursive: true, force: true });
  await fs.rm(bundledDir, { recursive: true, force: true });
});

describe('installUnionProfile', () => {
  test('installs bundled packs as directory + lockfile entry pairs, offline, and is idempotent', async () => {
    await writeBundledFixture();

    await installUnionProfile(NONO);

    // Every pack installed as a matched pair: dir on disk AND lockfile entry —
    // nono hard-errors on a pack dir with no lockfile entry, so a bare copy is
    // never enough.
    const lockfile = await readRuntimeLockfile();
    for (const pack of PACKS) {
      expect(lockfile.packages[pack]).toMatchObject({ version: '0.0.1' });
      // The copy performs no wiring, so the vendor machine's record is dropped.
      expect(lockfile.packages[pack].wiring_record).toEqual([]);
      await expect(
        fs.readFile(path.join(configBase, 'nono', 'packages', pack, 'package.json'), 'utf8'),
      ).resolves.toContain(pack);
    }
    expect(lockfile.lockfile_version).toBe(4);
    // The union profile is resolvable by name.
    const profile = JSON.parse(await fs.readFile(path.join(configBase, 'nono', 'profiles', 'ouijit.json'), 'utf8'));
    expect(profile.meta.name).toBe('ouijit');
    expect(profile.extends).toEqual(expect.arrayContaining([...PACKS]));
    // Fully offline: the registry fallback never ran.
    expect(execFileMock).not.toHaveBeenCalled();

    // Second run: everything already installed, nothing pulled or rewritten.
    const before = await fs.readFile(runtimeLockfilePath(), 'utf8');
    await installUnionProfile(NONO);
    expect(execFileMock).not.toHaveBeenCalled();
    await expect(fs.readFile(runtimeLockfilePath(), 'utf8')).resolves.toBe(before);
  });

  test("repairs broken pairs from the bundled tree without clobbering the user's own lockfile state", async () => {
    await writeBundledFixture();
    const packagesDir = path.join(configBase, 'nono', 'packages');
    // claude: a pack dir on disk with no lockfile entry, which makes nono fail
    // every run with "has no lockfile entry".
    const claudeDir = path.join(packagesDir, 'always-further', 'claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'stale.txt'), 'old contents', 'utf8');
    // acme/widget: a pack the user pulled themselves, which the merge must
    // leave untouched.
    const userPackDir = path.join(packagesDir, 'acme', 'widget');
    await fs.mkdir(userPackDir, { recursive: true });
    await fs.writeFile(path.join(userPackDir, 'user.json'), '{}', 'utf8');
    const userEntry = { version: '2.0.0', artifacts: { 'user.json': { sha256: 'def' } }, wiring_record: [] };
    // codex: the inverse broken half — a lockfile entry with no directory.
    await fs.writeFile(
      runtimeLockfilePath(),
      JSON.stringify({
        lockfile_version: 4,
        registry: 'https://example.com/custom',
        packages: { 'acme/widget': userEntry, 'always-further/codex': { version: '9.9.9', artifacts: {} } },
      }),
      'utf8',
    );

    await installUnionProfile(NONO);

    const lockfile = await readRuntimeLockfile();
    for (const pack of PACKS) expect(lockfile.packages[pack]).toBeDefined();
    // claude's stale dir was replaced wholesale so files always match the
    // entry's digests (a mismatched pair trips nono's tamper check).
    await expect(fs.access(path.join(claudeDir, 'stale.txt'))).rejects.toThrow();
    await expect(fs.readFile(path.join(claudeDir, 'package.json'), 'utf8')).resolves.toContain('claude');
    // codex's dangling entry was replaced together with its directory so the
    // pair stays matched.
    expect(lockfile.packages['always-further/codex'].version).toBe('0.0.1');
    await expect(fs.access(path.join(packagesDir, 'always-further', 'codex', 'package.json'))).resolves.toBeUndefined();
    // The user's own pack and top-level fields survive the merge untouched.
    expect(lockfile.packages['acme/widget']).toEqual(userEntry);
    expect(lockfile.registry).toBe('https://example.com/custom');
    await expect(fs.readFile(path.join(userPackDir, 'user.json'), 'utf8')).resolves.toBe('{}');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test('corrupt lockfiles are healed on both the bundled and the registry-pull path', async () => {
    await writeBundledFixture();
    await fs.mkdir(path.dirname(runtimeLockfilePath()), { recursive: true });
    // All flavors nono hard-errors on: unparseable JSON, valid JSON of the
    // wrong shape, and an object missing the required lockfile_version. Each
    // must be rewritten as a complete lockfile (entries AND version), or the
    // "heal" leaves nono just as broken as before.
    for (const corrupt of ['{not json', '[]', '"x"', '{"packages": {}}']) {
      await fs.writeFile(runtimeLockfilePath(), corrupt, 'utf8');

      await installUnionProfile(NONO);

      const lockfile = await readRuntimeLockfile();
      for (const pack of PACKS) expect(lockfile.packages[pack]).toBeDefined();
      expect(lockfile.lockfile_version).toBe(4);
    }
    expect(execFileMock).not.toHaveBeenCalled();

    // Dev builds (no bundled tree) must rewrite the corrupt file BEFORE the
    // registry fallback runs — `nono pull` itself hard-errors on a lockfile it
    // cannot parse, so leaving it in place would block the fallback forever.
    resolveBundledResourceDir.mockReturnValue(null);
    await fs.writeFile(runtimeLockfilePath(), '{not json', 'utf8');

    await installUnionProfile(NONO);

    const healed = await readRuntimeLockfile();
    expect(typeof healed.lockfile_version).toBe('number');
    expect(execFileMock).toHaveBeenCalledTimes(PACKS.length);
  });

  test('without a bundled tree every missing pack is registry-pulled, and a failed pull surfaces a clear error', async () => {
    resolveBundledResourceDir.mockReturnValue(null);

    await installUnionProfile(NONO);

    expect(execFileMock).toHaveBeenCalledTimes(PACKS.length);
    for (const pack of PACKS) {
      expect(execFileMock).toHaveBeenCalledWith(NONO, ['pull', pack], expect.any(Function));
    }

    // The mocked pulls installed nothing, so every pack is still missing; a
    // failing registry now must reject with an error naming the pack.
    execFileMock.mockImplementation((_file, _args, cb) => cb(new Error('network down')));
    await expect(installUnionProfile(NONO)).rejects.toThrow(
      /Could not install the nono agent profile 'always-further\/claude'/,
    );
  });
});
