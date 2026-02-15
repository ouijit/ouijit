import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import { app } from 'electron';
import type { LimaInstance } from './types';
import { generateLimaYaml, buildLimaConfig } from './config';
import { resetSetupTracking } from './spawn';

const execFileAsync = promisify(execFile);

/** Add actionable context to common Lima error messages */
function contextualizeError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('etimedout') || lower.includes('timeout') || lower.includes('timed out')) {
    return `${msg} — timed out, check your network connection`;
  }
  if (lower.includes('enospc') || lower.includes('no space')) {
    return `${msg} — not enough disk space`;
  }
  return msg;
}

/** Get the path to the bundled limactl binary */
export function getLimactlPath(): string {
  const bundled = path.join(process.resourcesPath ?? '', 'bin', 'limactl');
  try {
    fsSync.accessSync(bundled, fsSync.constants.X_OK);
    return bundled;
  } catch {
    return 'limactl';
  }
}

/** Get env with LIMA_HOME set to Ouijit-specific directory */
export function getLimaEnv(): Record<string, string> {
  const limaHome = path.join(app.getPath('userData'), 'lima');
  return { ...process.env, LIMA_HOME: limaHome } as Record<string, string>;
}

/**
 * Check if limactl is available (bundled binary or system PATH)
 */
export async function isLimaInstalled(): Promise<boolean> {
  if (getLimactlPath() !== 'limactl') return true;
  try {
    await execFileAsync('which', ['limactl']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive a stable instance name from a project path
 */
export function getInstanceName(projectPath: string): string {
  const basename = path.basename(projectPath);
  // Sanitize: only alphanumeric and hyphens
  const sanitized = basename.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  return `ouijit-${sanitized}`;
}

/**
 * Get info about a Lima instance by name
 */
export async function getInstance(name: string): Promise<LimaInstance> {
  try {
    const { stdout } = await execFileAsync(getLimactlPath(), ['list', '--json'], { env: getLimaEnv() });
    // limactl list --json outputs one JSON object per line
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const obj = JSON.parse(line);
      if (obj.name === name) {
        return {
          name: obj.name,
          status: obj.status || 'Stopped',
          cpus: obj.cpus || 0,
          memory: obj.memory || 0,
          disk: obj.disk || 0,
          mounts: (obj.config?.mounts || []).map((m: { location: string; mountPoint: string; writable?: boolean }) => ({
            hostPath: m.location,
            guestPath: m.mountPoint,
            writable: m.writable ?? false,
          })),
        };
      }
    }
  } catch (error) {
    console.warn('[Lima] getInstance failed:', error instanceof Error ? error.message : error);
  }
  return { name, status: 'NotFound', cpus: 0, memory: 0, disk: 0, mounts: [] };
}

/**
 * Create a new Lima instance from a config
 */
export async function createInstance(
  projectPath: string,
  overrides?: { cpus?: number; memoryGiB?: number; diskGiB?: number; networkMode?: 'vzNAT' | 'none' }
): Promise<{ success: boolean; error?: string }> {
  const instanceName = getInstanceName(projectPath);
  const config = buildLimaConfig(instanceName, projectPath, overrides);
  const yaml = generateLimaYaml(config);

  // Write YAML to a temp file
  const tmpDir = os.tmpdir();
  const yamlPath = path.join(tmpDir, `${instanceName}.yaml`);
  await fs.writeFile(yamlPath, yaml, 'utf-8');

  try {
    await execFileAsync(getLimactlPath(), ['create', '--name', instanceName, yamlPath], {
      timeout: 300_000, env: getLimaEnv(),
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    // Clean up partially-created VM so we don't leave it in a broken state
    try {
      await execFileAsync(getLimactlPath(), ['delete', '--force', instanceName], {
        timeout: 30_000, env: getLimaEnv(),
      });
    } catch {
      // Ignore — VM may not have been created at all
    }
    return { success: false, error: `Failed to create VM: ${contextualizeError(msg)}` };
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(yamlPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Tail ha.stderr.log during VM startup and forward human-readable progress.
 * Returns a cleanup function to stop tailing.
 */
function tailHostAgentLog(instanceName: string, onMessage: (msg: string) => void): () => void {
  const env = getLimaEnv();
  const logPath = path.join(env.LIMA_HOME, instanceName, 'ha.stderr.log');

  let offset = 0;
  let stopped = false;

  // Start from current end of file so we only see new messages
  try {
    offset = fsSync.statSync(logPath).size;
  } catch {
    // Log may not exist yet — will pick it up on first poll
  }

  const interval = setInterval(() => {
    if (stopped) return;
    try {
      const size = fsSync.statSync(logPath).size;
      if (size <= offset) return;

      const fd = fsSync.openSync(logPath, 'r');
      const buf = Buffer.alloc(size - offset);
      fsSync.readSync(fd, buf, 0, buf.length, offset);
      fsSync.closeSync(fd);
      offset = size;

      for (const line of buf.toString('utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.level !== 'info') continue;
          const msg: string = entry.msg;
          // Skip noisy port-forwarding chatter
          if (msg.startsWith('Not forwarding') || msg.startsWith('Forwarding')) continue;
          onMessage(msg);
        } catch {
          // Not valid JSON — skip
        }
      }
    } catch {
      // File may not exist yet during early startup
    }
  }, 500);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/**
 * Start a Lima instance
 */
export async function startInstance(name: string, onProgress?: (message: string) => void): Promise<{ success: boolean; error?: string }> {
  const stopTailing = onProgress ? tailHostAgentLog(name, onProgress) : undefined;
  try {
    await execFileAsync(getLimactlPath(), ['start', name], {
      timeout: 300_000, env: getLimaEnv(),
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to start VM: ${contextualizeError(msg)}` };
  } finally {
    stopTailing?.();
  }
}

/**
 * Stop a Lima instance
 */
export async function stopInstance(name: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync(getLimactlPath(), ['stop', name], {
      timeout: 30_000, env: getLimaEnv(),
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to stop VM: ${msg}` };
  }
}

/**
 * Delete a Lima instance
 */
export async function deleteInstance(name: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync(getLimactlPath(), ['delete', '--force', name], {
      timeout: 30_000, env: getLimaEnv(),
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to delete VM: ${msg}` };
  }
}

/**
 * Wait for SSH to be ready by probing with a simple command.
 * Lima may report "Running" before SSH is fully accepting connections.
 * Uses exponential backoff: 1s, 2s, 4s, 8s, 10s, 10s, ... (~60s total)
 */
async function waitForSsh(
  instanceName: string,
  maxRetries = 10,
  onProgress?: (message: string) => void,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    onProgress?.(`Waiting for SSH (attempt ${i + 1}/${maxRetries})…`);
    try {
      await execFileAsync(getLimactlPath(), ['shell', instanceName, '--', 'echo', 'ok'], {
        timeout: 10_000, env: getLimaEnv(),
      });
      return true;
    } catch {
      if (i < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 10_000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  return false;
}

/**
 * Ensure an instance is running. Creates if missing, starts if stopped.
 */
export async function ensureRunning(
  projectPath: string,
  overrides?: { cpus?: number; memoryGiB?: number; diskGiB?: number; networkMode?: 'vzNAT' | 'none' },
  onProgress?: (message: string) => void,
): Promise<{ success: boolean; instanceName: string; error?: string }> {
  const progress = onProgress ?? (() => {});
  const instanceName = getInstanceName(projectPath);

  progress('Checking VM status…');
  const instance = await getInstance(instanceName);

  if (instance.status === 'Running') {
    progress('Waiting for SSH…');
    if (!await waitForSsh(instanceName, 10, progress)) {
      return { success: false, instanceName, error: 'VM is running but SSH is not responding after multiple attempts. The VM may need to be recreated.' };
    }
    return { success: true, instanceName };
  }

  if (instance.status === 'NotFound') {
    progress('Creating sandbox VM (this may take a few minutes)…');
    const createResult = await createInstance(projectPath, overrides);
    if (!createResult.success) {
      return { success: false, instanceName, error: createResult.error };
    }
    progress('Starting sandbox VM…');
    const startResult = await startInstance(instanceName, progress);
    if (!startResult.success) {
      return { success: false, instanceName, error: startResult.error };
    }
    resetSetupTracking(instanceName);
    return { success: true, instanceName };
  }

  if (instance.status === 'Stopped') {
    progress('Starting sandbox VM…');
    const startResult = await startInstance(instanceName, progress);
    if (!startResult.success) {
      return { success: false, instanceName, error: startResult.error };
    }
    resetSetupTracking(instanceName);
    return { success: true, instanceName };
  }

  // Broken — delete and recreate
  progress('Recreating sandbox VM…');
  const deleteResult = await deleteInstance(instanceName);
  if (!deleteResult.success) {
    return { success: false, instanceName, error: `Cannot recreate VM: failed to delete broken instance. ${deleteResult.error}` };
  }
  const createResult = await createInstance(projectPath, overrides);
  if (!createResult.success) {
    return { success: false, instanceName, error: createResult.error };
  }
  progress('Starting sandbox VM…');
  const startResult = await startInstance(instanceName, progress);
  if (!startResult.success) {
    return { success: false, instanceName, error: startResult.error };
  }
  resetSetupTracking(instanceName);
  return { success: true, instanceName };
}

/**
 * Stop all running ouijit-* instances. Synchronous — safe to call during app quit.
 */
export function stopAllInstances(): void {
  const limactl = getLimactlPath();
  const env = getLimaEnv();

  try {
    const stdout = execFileSync(limactl, ['list', '--json'], { env, timeout: 5_000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.name?.startsWith('ouijit-') && obj.status === 'Running') {
          execFileSync(limactl, ['stop', '--force', obj.name], { env, timeout: 15_000, stdio: 'ignore' });
        }
      } catch {
        // Best-effort during shutdown — ignore failures
      }
    }
  } catch {
    // limactl not available or no instances — nothing to do
  }
}
