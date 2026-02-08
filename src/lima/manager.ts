import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import { app } from 'electron';
import type { LimaInstance } from './types';
import { generateLimaYaml, buildLimaConfig } from './config';

const execFileAsync = promisify(execFile);

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
  } catch {
    // limactl not available or failed
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
    return { success: false, error: `Failed to create VM: ${msg}` };
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
 * Start a Lima instance
 */
export async function startInstance(name: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync(getLimactlPath(), ['start', name], {
      timeout: 120_000, env: getLimaEnv(),
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to start VM: ${msg}` };
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
 */
async function waitForSsh(instanceName: string, maxRetries = 5): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await execFileAsync(getLimactlPath(), ['shell', instanceName, '--', 'echo', 'ok'], {
        timeout: 10_000, env: getLimaEnv(),
      });
      return true;
    } catch {
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000));
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
    if (!await waitForSsh(instanceName)) {
      return { success: false, instanceName, error: 'VM is running but SSH is not responding' };
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
    const startResult = await startInstance(instanceName);
    if (!startResult.success) {
      return { success: false, instanceName, error: startResult.error };
    }
    return { success: true, instanceName };
  }

  if (instance.status === 'Stopped') {
    progress('Starting sandbox VM…');
    const startResult = await startInstance(instanceName);
    if (!startResult.success) {
      return { success: false, instanceName, error: startResult.error };
    }
    return { success: true, instanceName };
  }

  // Broken — delete and recreate
  progress('Recreating sandbox VM…');
  await deleteInstance(instanceName);
  const createResult = await createInstance(projectPath, overrides);
  if (!createResult.success) {
    return { success: false, instanceName, error: createResult.error };
  }
  progress('Starting sandbox VM…');
  const startResult = await startInstance(instanceName);
  if (!startResult.success) {
    return { success: false, instanceName, error: startResult.error };
  }
  return { success: true, instanceName };
}

/**
 * Stop all running ouijit-* instances. Synchronous — safe to call during app quit.
 */
export function stopAllInstances(): void {
  const limactl = getLimactlPath();
  const env = getLimaEnv();

  try {
    const stdout = execFileSync(limactl, ['list', '--json'], { env, timeout: 5_000, encoding: 'utf-8' });
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.name?.startsWith('ouijit-') && obj.status === 'Running') {
          console.log(`Stopping Lima VM: ${obj.name}`);
          execFileSync(limactl, ['stop', '--force', obj.name], { env, timeout: 15_000 });
        }
      } catch {
        // Best-effort per instance
      }
    }
  } catch {
    // limactl not available or no instances — nothing to do
  }
}
