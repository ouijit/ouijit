import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { LimaInstance, LimaMount } from './types';
import { generateLimaYaml, buildLimaConfig } from './config';

const execFileAsync = promisify(execFile);

/**
 * Check if limactl binary is available on PATH
 */
export async function isLimaInstalled(): Promise<boolean> {
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
    const { stdout } = await execFileAsync('limactl', ['list', '--json']);
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
  return { name, status: 'NotFound', cpus: 0, memory: 0, mounts: [] };
}

/**
 * Create a new Lima instance from a config
 */
export async function createInstance(
  projectPath: string,
  overrides?: { cpus?: number; memoryGiB?: number; networkMode?: 'vzNAT' | 'none' }
): Promise<{ success: boolean; error?: string }> {
  const instanceName = getInstanceName(projectPath);
  const config = buildLimaConfig(instanceName, projectPath, overrides);
  const yaml = generateLimaYaml(config);

  // Write YAML to a temp file
  const tmpDir = os.tmpdir();
  const yamlPath = path.join(tmpDir, `${instanceName}.yaml`);
  await fs.writeFile(yamlPath, yaml, 'utf-8');

  try {
    await execFileAsync('limactl', ['create', '--name', instanceName, yamlPath], {
      timeout: 300_000, // 5 minutes for image download + setup
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
    await execFileAsync('limactl', ['start', name], {
      timeout: 120_000,
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
    await execFileAsync('limactl', ['stop', name], {
      timeout: 30_000,
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
    await execFileAsync('limactl', ['delete', '--force', name], {
      timeout: 30_000,
    });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to delete VM: ${msg}` };
  }
}

/**
 * Ensure an instance is running. Creates if missing, starts if stopped.
 */
export async function ensureRunning(
  projectPath: string,
  overrides?: { cpus?: number; memoryGiB?: number; networkMode?: 'vzNAT' | 'none' }
): Promise<{ success: boolean; instanceName: string; error?: string }> {
  const instanceName = getInstanceName(projectPath);
  const instance = await getInstance(instanceName);

  if (instance.status === 'Running') {
    return { success: true, instanceName };
  }

  if (instance.status === 'NotFound') {
    const createResult = await createInstance(projectPath, overrides);
    if (!createResult.success) {
      return { success: false, instanceName, error: createResult.error };
    }
    const startResult = await startInstance(instanceName);
    if (!startResult.success) {
      return { success: false, instanceName, error: startResult.error };
    }
    return { success: true, instanceName };
  }

  if (instance.status === 'Stopped') {
    const startResult = await startInstance(instanceName);
    if (!startResult.success) {
      return { success: false, instanceName, error: startResult.error };
    }
    return { success: true, instanceName };
  }

  // Broken — delete and recreate
  await deleteInstance(instanceName);
  const createResult = await createInstance(projectPath, overrides);
  if (!createResult.success) {
    return { success: false, instanceName, error: createResult.error };
  }
  const startResult = await startInstance(instanceName);
  if (!startResult.success) {
    return { success: false, instanceName, error: startResult.error };
  }
  return { success: true, instanceName };
}

/**
 * Translate a host path to the corresponding guest path using the mount config.
 * Returns the original path if no mount matches.
 */
export function hostPathToGuestPath(hostPath: string, mounts: LimaMount[]): string {
  for (const mount of mounts) {
    if (hostPath === mount.hostPath || hostPath.startsWith(mount.hostPath + '/')) {
      const relative = hostPath.slice(mount.hostPath.length);
      return mount.guestPath + relative;
    }
  }
  // Fallback: return original (host-path symlinks inside VM should resolve it)
  return hostPath;
}
