import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { isLimaInstalled } from './lima/manager';
import { isNonoInstalled } from './sandbox/nono/binary';
import { probeGh } from './github/client';
import { ensureLoginPath } from './loginPath';
import { getWrapperBinDir } from './wrapperBin';
import { getLogger } from './logger';

const execFileAsync = promisify(execFile);

const healthLog = getLogger().scope('health');

export interface HealthStatus {
  git: boolean;
  claude: boolean;
  codex: boolean;
  pi: boolean;
  opencode: boolean;
  lima: boolean;
  nono: boolean;
  gitVersion?: string;
  /** `gh` is on PATH. The GitHub panel needs it; nothing else does. */
  gh: boolean;
  /** False when gh is installed but too old for the flags this app passes. */
  ghVersionOk: boolean;
  ghVersion?: string;
}

let cached: HealthStatus | null = null;

async function detectGit(): Promise<{ ok: boolean; version?: string }> {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    const match = /git version (\S+)/.exec(stdout);
    return { ok: true, version: match?.[1] };
  } catch {
    return { ok: false };
  }
}

/**
 * A PATH with the Ouijit wrapper directory taken out of it.
 *
 * `which codex` finds `~/.config/Ouijit/bin/codex` whether or not codex is
 * installed: that file is ours, a shell script that goes looking for the real
 * binary and only fails once it is run. Probing through it reports all four
 * agents present on a machine that has none of them — and the lens then picks
 * one of them as its default and dies at spawn.
 */
export function withoutWrapperDir(pathValue: string, wrapperDir: string): string {
  return pathValue
    .split(path.delimiter)
    .filter((dir) => dir && path.resolve(dir) !== path.resolve(wrapperDir))
    .join(path.delimiter);
}

/** Whether the real binary — not our wrapper for it — is on PATH. */
async function detectAgent(binary: string): Promise<boolean> {
  try {
    await execFileAsync('which', [binary], {
      env: { ...process.env, PATH: withoutWrapperDir(process.env.PATH ?? '', getWrapperBinDir()) },
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkHealth(): Promise<HealthStatus> {
  // Before anything is looked for. A windowed launch inherits a PATH with
  // none of the places these binaries install themselves into.
  ensureLoginPath();

  const [git, claude, codex, pi, opencode, lima, nono, gh] = await Promise.all([
    detectGit(),
    detectAgent('claude'),
    detectAgent('codex'),
    detectAgent('pi'),
    detectAgent('opencode'),
    isLimaInstalled(),
    isNonoInstalled(),
    probeGh(),
  ]);
  cached = {
    git: git.ok,
    claude,
    codex,
    pi,
    opencode,
    lima,
    nono,
    gitVersion: git.version,
    gh: gh.installed,
    ghVersionOk: gh.versionOk,
    ghVersion: gh.version,
  };
  healthLog.info('health probe', {
    git: cached.git,
    claude: cached.claude,
    codex: cached.codex,
    pi: cached.pi,
    opencode: cached.opencode,
    lima: cached.lima,
    nono: cached.nono,
    gitVersion: cached.gitVersion,
    gh: cached.gh,
    ghVersion: cached.ghVersion,
  });
  return cached;
}

export function getCachedHealth(): HealthStatus | null {
  return cached;
}

export async function refreshHealth(): Promise<HealthStatus> {
  return checkHealth();
}
