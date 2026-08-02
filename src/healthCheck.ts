import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isLimaInstalled } from './lima/manager';
import { isNonoInstalled } from './sandbox/nono/binary';
import { probeGh } from './github/client';
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
  /** `gh` holds credentials. False means the panel shows "run gh auth login". */
  ghAuthenticated: boolean;
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

async function detectClaude(): Promise<boolean> {
  try {
    await execFileAsync('which', ['claude']);
    return true;
  } catch {
    return false;
  }
}

async function detectCodex(): Promise<boolean> {
  try {
    await execFileAsync('which', ['codex']);
    return true;
  } catch {
    return false;
  }
}

async function detectPi(): Promise<boolean> {
  try {
    await execFileAsync('which', ['pi']);
    return true;
  } catch {
    return false;
  }
}

async function detectOpencode(): Promise<boolean> {
  try {
    await execFileAsync('which', ['opencode']);
    return true;
  } catch {
    return false;
  }
}

export async function checkHealth(): Promise<HealthStatus> {
  const [git, claude, codex, pi, opencode, lima, nono, gh] = await Promise.all([
    detectGit(),
    detectClaude(),
    detectCodex(),
    detectPi(),
    detectOpencode(),
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
    ghAuthenticated: gh.authenticated,
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
    ghAuthenticated: cached.ghAuthenticated,
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
