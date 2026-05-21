import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isLimaInstalled } from './lima/manager';
import { getLogger } from './logger';

const execFileAsync = promisify(execFile);

const healthLog = getLogger().scope('health');

export interface HealthStatus {
  git: boolean;
  claude: boolean;
  codex: boolean;
  pi: boolean;
  lima: boolean;
  gitVersion?: string;
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

export async function checkHealth(): Promise<HealthStatus> {
  const [git, claude, codex, pi, lima] = await Promise.all([
    detectGit(),
    detectClaude(),
    detectCodex(),
    detectPi(),
    isLimaInstalled(),
  ]);
  cached = { git: git.ok, claude, codex, pi, lima, gitVersion: git.version };
  healthLog.info('health probe', {
    git: cached.git,
    claude: cached.claude,
    codex: cached.codex,
    pi: cached.pi,
    lima: cached.lima,
    gitVersion: cached.gitVersion,
  });
  return cached;
}

export function getCachedHealth(): HealthStatus | null {
  return cached;
}

export async function refreshHealth(): Promise<HealthStatus> {
  return checkHealth();
}
