import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import type { LimaInstance, SandboxStatus } from './types';
import { buildFinalConfig } from './configStore';
import { getLogger } from '../logger';
import { getUserDataPath } from '../paths';

const limaLog = getLogger().scope('lima');

const execFileAsync = promisify(execFile);

export interface ProgressStep {
  id: string;
  label: string;
  status: 'active' | 'done';
}

export type ProgressCallback = (step: ProgressStep) => void;

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
  const limaHome = path.join(getUserDataPath(), 'lima');
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
 * Derive a stable, short instance name from a project path.
 * Uses a 12-char hex hash to stay well under the macOS UNIX socket
 * path limit (104 bytes) regardless of LIMA_HOME length.
 */
export function getInstanceName(projectPath: string): string {
  const hash = createHash('sha256').update(projectPath).digest('hex').slice(0, 12);
  return `ouijit-${hash}`;
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
    limaLog.warn('getInstance failed', { name, error: error instanceof Error ? error.message : String(error) });
  }
  return { name, status: 'NotFound', cpus: 0, memory: 0, disk: 0, mounts: [] };
}

/**
 * Create a new Lima instance from the project's YAML config.
 * Merges user config with Ouijit-managed fields and resolves env vars.
 */
export async function createInstance(
  projectPath: string,
): Promise<{ success: boolean; error?: string; warnings?: string[] }> {
  const instanceName = getInstanceName(projectPath);
  const { yaml, warnings } = await buildFinalConfig(projectPath);

  // Write YAML to a temp file
  const tmpDir = os.tmpdir();
  const yamlPath = path.join(tmpDir, `${instanceName}.yaml`);
  await fs.writeFile(yamlPath, yaml, 'utf-8');

  try {
    await execFileAsync(getLimactlPath(), ['create', '--name', instanceName, yamlPath], {
      timeout: 300_000,
      env: getLimaEnv(),
    });
    return { success: true, warnings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    // Clean up partially-created VM so we don't leave it in a broken state
    try {
      await execFileAsync(getLimactlPath(), ['delete', '--force', instanceName], {
        timeout: 30_000,
        env: getLimaEnv(),
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
          // Skip noisy/long log messages
          if (msg.startsWith('Not forwarding') || msg.startsWith('Forwarding')) continue;
          if (msg.includes('(hint:')) continue;
          if (msg.startsWith('[VZ]')) continue;
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
export async function startInstance(
  name: string,
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; error?: string }> {
  const stopTailing = onProgress
    ? tailHostAgentLog(name, (msg) => onProgress({ id: 'start', label: msg, status: 'active' }))
    : undefined;
  try {
    await execFileAsync(getLimactlPath(), ['start', name], {
      timeout: 300_000,
      env: getLimaEnv(),
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
      timeout: 30_000,
      env: getLimaEnv(),
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
      timeout: 30_000,
      env: getLimaEnv(),
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
async function waitForSsh(instanceName: string, maxRetries = 10, onProgress?: ProgressCallback): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    onProgress?.({ id: 'ssh', label: `Connecting via SSH… (${i + 1}/${maxRetries})`, status: 'active' });
    try {
      await execFileAsync(getLimactlPath(), ['shell', instanceName, '--', 'echo', 'ok'], {
        timeout: 10_000,
        env: getLimaEnv(),
      });
      return true;
    } catch {
      if (i < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 10_000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return false;
}

/**
 * Wait for cloud-init provisioning to complete inside the VM.
 * Lima's provision scripts run via cloud-init, which writes a sentinel
 * file when all modules (including user scripts) have finished.
 */
async function waitForProvisioning(
  instanceName: string,
  maxRetries = 60,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  const start = Date.now();
  for (let i = 0; i < maxRetries; i++) {
    const elapsed = Math.round((Date.now() - start) / 1000);
    onProgress?.({ id: 'provision', label: `Installing packages & provisioning… ${elapsed}s`, status: 'active' });
    try {
      await execFileAsync(
        getLimactlPath(),
        ['shell', instanceName, '--', 'test', '-f', '/var/lib/cloud/instance/boot-finished'],
        { timeout: 5_000, env: getLimaEnv() },
      );
      return true;
    } catch {
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2_000));
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
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; instanceName: string; error?: string }> {
  const progress = onProgress ?? (() => {});
  const instanceName = getInstanceName(projectPath);

  progress({ id: 'status', label: 'Checking VM status…', status: 'active' });
  const instance = await getInstance(instanceName);
  progress({ id: 'status', label: 'Checking VM status…', status: 'done' });

  if (instance.status === 'Running') {
    if (!(await waitForSsh(instanceName, 10, progress))) {
      return {
        success: false,
        instanceName,
        error: 'VM is running but SSH is not responding after multiple attempts. The VM may need to be recreated.',
      };
    }
    progress({ id: 'ssh', label: 'SSH connected', status: 'done' });
    await waitForProvisioning(instanceName, 60, progress);
    progress({ id: 'provision', label: 'Provisioning complete', status: 'done' });
    return { success: true, instanceName };
  }

  if (instance.status === 'NotFound') {
    // limactl create both creates and starts the VM
    progress({ id: 'create', label: 'Creating and starting sandbox VM…', status: 'active' });
    const createResult = await createInstance(projectPath);
    if (!createResult.success) {
      return { success: false, instanceName, error: createResult.error };
    }
    progress({ id: 'create', label: 'VM created and started', status: 'done' });

    if (!(await waitForSsh(instanceName, 10, progress))) {
      return { success: false, instanceName, error: 'SSH not responding after VM start.' };
    }
    progress({ id: 'ssh', label: 'SSH connected', status: 'done' });

    await waitForProvisioning(instanceName, 60, progress);
    progress({ id: 'provision', label: 'Provisioning complete', status: 'done' });
    return { success: true, instanceName };
  }

  if (instance.status === 'Stopped') {
    progress({ id: 'start', label: 'Starting sandbox VM…', status: 'active' });
    const startResult = await startInstance(instanceName, progress);
    if (!startResult.success) {
      return { success: false, instanceName, error: startResult.error };
    }
    progress({ id: 'start', label: 'VM started', status: 'done' });
    return { success: true, instanceName };
  }

  // Broken — delete and recreate
  progress({ id: 'cleanup', label: 'Removing broken VM…', status: 'active' });
  const deleteResult = await deleteInstance(instanceName);
  if (!deleteResult.success) {
    return {
      success: false,
      instanceName,
      error: `Cannot recreate VM: failed to delete broken instance. ${deleteResult.error}`,
    };
  }
  progress({ id: 'cleanup', label: 'Broken VM removed', status: 'done' });

  progress({ id: 'create', label: 'Creating and starting sandbox VM…', status: 'active' });
  const createResult2 = await createInstance(projectPath);
  if (!createResult2.success) {
    return { success: false, instanceName, error: createResult2.error };
  }
  progress({ id: 'create', label: 'VM created and started', status: 'done' });

  if (!(await waitForSsh(instanceName, 10, progress))) {
    return { success: false, instanceName, error: 'SSH not responding after VM start.' };
  }
  progress({ id: 'ssh', label: 'SSH connected', status: 'done' });

  await waitForProvisioning(instanceName, 60, progress);
  progress({ id: 'provision', label: 'Provisioning complete', status: 'done' });
  return { success: true, instanceName };
}

/**
 * Get the sandbox status for a project, mapping Lima instance status to UI-level SandboxStatus.
 */
export async function getLimaStatus(projectPath: string): Promise<SandboxStatus> {
  const available = await isLimaInstalled();
  if (!available) {
    return { available: false, vmStatus: 'Unavailable' };
  }

  const instanceName = getInstanceName(projectPath);
  const instance = await getInstance(instanceName);

  let vmStatus: SandboxStatus['vmStatus'];
  switch (instance.status) {
    case 'Running':
      vmStatus = 'Running';
      break;
    case 'Stopped':
      vmStatus = 'Stopped';
      break;
    case 'Broken':
      vmStatus = 'Broken';
      break;
    case 'NotFound':
      vmStatus = 'NotCreated';
      break;
    default:
      vmStatus = 'Stopped';
      break;
  }

  return {
    available: true,
    vmStatus,
    instanceName,
    ...(vmStatus !== 'NotCreated' && { memory: instance.memory, disk: instance.disk }),
  };
}

/**
 * Recreate a Lima instance: stop → delete → create → start.
 */
export async function recreateInstance(
  projectPath: string,
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; error?: string }> {
  const progress = onProgress ?? (() => {});
  const instanceName = getInstanceName(projectPath);

  try {
    const instance = await getInstance(instanceName);
    if (instance.status === 'Running') {
      progress({ id: 'stop', label: 'Stopping VM…', status: 'active' });
      const stopResult = await stopInstance(instanceName);
      if (!stopResult.success) return { success: false, error: stopResult.error };
      progress({ id: 'stop', label: 'VM stopped', status: 'done' });
    }

    if (instance.status !== 'NotFound') {
      progress({ id: 'delete', label: 'Deleting VM…', status: 'active' });
      const delResult = await deleteInstance(instanceName);
      if (!delResult.success) return { success: false, error: delResult.error };
      progress({ id: 'delete', label: 'VM deleted', status: 'done' });
    }

    progress({ id: 'create', label: 'Creating and starting sandbox VM…', status: 'active' });
    const createResult = await createInstance(projectPath);
    if (!createResult.success) return { success: false, error: createResult.error };
    progress({ id: 'create', label: 'VM created and started', status: 'done' });

    if (!(await waitForSsh(instanceName, 10, progress))) {
      return { success: false, error: 'SSH not responding after VM start.' };
    }
    progress({ id: 'ssh', label: 'SSH connected', status: 'done' });

    await waitForProvisioning(instanceName, 60, progress);
    progress({ id: 'provision', label: 'Provisioning complete', status: 'done' });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

/**
 * Delete a Lima instance, stopping it first if running.
 */
export async function deleteWithCleanup(projectPath: string): Promise<{ success: boolean; error?: string }> {
  const instanceName = getInstanceName(projectPath);
  try {
    const instance = await getInstance(instanceName);
    if (instance.status === 'Running') {
      const stopResult = await stopInstance(instanceName);
      if (!stopResult.success) return { success: false, error: stopResult.error };
    }
    if (instance.status !== 'NotFound') {
      return deleteInstance(instanceName);
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

/**
 * Stop all running ouijit-* instances. Synchronous — safe to call during app quit.
 */
export function stopAllInstances(): void {
  const limactl = getLimactlPath();
  const env = getLimaEnv();

  try {
    const stdout = execFileSync(limactl, ['list', '--json'], {
      env,
      timeout: 5_000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
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
