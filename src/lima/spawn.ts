import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { PtySpawnOptions, PtySpawnResult, PtyId } from '../types';
import type { ActiveSession } from '../ptyManager';
import { generateId } from '../utils/ids';
import { ensureRunning, getLimactlPath, getLimaEnv } from './manager';
import { getApiPort, HELPER_SCRIPT, buildVmHookSettings } from '../hookServer';

interface ManagedSandboxPty {
  process: pty.IPty;
  projectPath: string;
  command: string;
  label: string;
  taskId?: number;
  worktreePath?: string;
  isRunner: boolean;
  parentPtyId?: PtyId;
  outputChunks: string[];
  outputSize: number;
  maxBufferSize: number;
}

const activeSandboxPtys = new Map<PtyId, ManagedSandboxPty>();
let currentWindow: BrowserWindow | null = null;

const MAX_BUFFER_SIZE = 100 * 1024;

function handleOutput(ptyId: PtyId, channel: string, data: string): void {
  const managed = activeSandboxPtys.get(ptyId);
  if (!managed) return;

  managed.outputChunks.push(data);
  managed.outputSize += data.length;

  while (managed.outputSize > managed.maxBufferSize && managed.outputChunks.length > 1) {
    const removed = managed.outputChunks.shift()!;
    managed.outputSize -= removed.length;
  }

  if (currentWindow && !currentWindow.isDestroyed()) {
    currentWindow.webContents.send(channel, data);
  }
}

/**
 * Build bash commands that inject the ouijit-hook script and Claude settings
 * into the VM's ephemeral home directory. Runs once per shell spawn so hooks
 * are always fresh (never stale).
 */
function buildVmHookSetup(): string {
  const hookScript = HELPER_SCRIPT;
  const hookSettings = buildVmHookSettings();
  return [
    // Write hook script using quoted heredoc (prevents $VAR expansion at write time)
    `cat > ~/ouijit-hook <<'OUIJIT_HOOK_EOF'`,
    hookScript,
    'OUIJIT_HOOK_EOF',
    'chmod +x ~/ouijit-hook',
    // Write Claude settings
    'mkdir -p ~/.claude',
    `cat > ~/.claude/settings.json <<'OUIJIT_SETTINGS_EOF'`,
    hookSettings,
    'OUIJIT_SETTINGS_EOF',
    '',
  ].join('\n');
}

/**
 * Spawn a sandboxed PTY via `limactl shell`.
 * Worktree files are shared via writable mounts — no sync needed.
 */
export async function spawnSandboxedPty(options: PtySpawnOptions, window: BrowserWindow): Promise<PtySpawnResult> {
  try {
    currentWindow = window;
    const projectPath = options.projectPath || options.cwd;

    // Ensure VM is running, forwarding progress to the renderer
    const vmResult = await ensureRunning(projectPath, (msg) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('lima:spawn-progress', msg);
      }
    });
    if (!vmResult.success) {
      return { success: false, error: vmResult.error || 'Failed to start sandbox VM' };
    }

    const instanceName = vmResult.instanceName;
    const sendProgress = (msg: string) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('lima:spawn-progress', msg);
      }
    };

    sendProgress('Launching shell…');

    // Use host cwd directly — mounts match host paths
    const guestCwd = options.cwd;

    // Export Ouijit env vars inside the VM since SSH doesn't forward them
    let envExports = '';
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (value !== undefined) {
          const escapedValue = value.replace(/'/g, "'\\''");
          envExports += `export ${key}='${escapedValue}'\n`;
        }
      }
    }

    const ptyId = generateId('pty-sandbox');

    // Inject hook API env vars into the VM shell (host.lima.internal resolves to host)
    envExports += `export OUIJIT_PTY_ID='${ptyId}'\n`;
    envExports += `export OUIJIT_API_URL='http://host.lima.internal:${getApiPort()}'\n`;

    // Inject hook script + Claude settings into VM's ephemeral home dir
    const hookSetup = buildVmHookSetup();

    // Build the command to run inside the VM
    let innerCmd: string;
    if (options.command) {
      // Run command then drop to interactive bash
      const escapedCmd = options.command.replace(/'/g, "'\\''");
      innerCmd = `${envExports}${hookSetup}${escapedCmd}; exec bash`;
    } else {
      innerCmd = `${envExports}${hookSetup}exec bash`;
    }

    // Build limactl shell args
    const limactlArgs = ['shell', '--workdir', guestCwd, instanceName, '--', 'bash', '-c', innerCmd];

    // Build environment: pass through env vars via limactl's environment
    const baseEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        baseEnv[key] = value;
      }
    }
    const finalEnv: Record<string, string> = {
      ...baseEnv,
      TERM: 'xterm-256color',
    };
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (value !== undefined) {
          finalEnv[key] = value;
        }
      }
    }

    const ptyProcess = pty.spawn(getLimactlPath(), limactlArgs, {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      env: { ...finalEnv, LIMA_HOME: getLimaEnv().LIMA_HOME },
    });

    const label = options.label || options.command || 'Sandbox Shell';

    const managed: ManagedSandboxPty = {
      process: ptyProcess,
      projectPath,
      command: options.command || '',
      label,
      taskId: options.taskId,
      worktreePath: options.worktreePath,
      isRunner: options.isRunner || false,
      parentPtyId: options.parentPtyId,
      outputChunks: [],
      outputSize: 0,
      maxBufferSize: MAX_BUFFER_SIZE,
    };

    activeSandboxPtys.set(ptyId, managed);

    ptyProcess.onData((data: string) => {
      handleOutput(ptyId, `pty:data:${ptyId}`, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      try {
        if (currentWindow && !currentWindow.isDestroyed()) {
          currentWindow.webContents.send(`pty:exit:${ptyId}`, exitCode);
        }
      } finally {
        activeSandboxPtys.delete(ptyId);
      }
    });

    return { success: true, ptyId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to spawn sandboxed PTY',
    };
  }
}

/**
 * Check if a PTY ID belongs to a sandbox PTY
 */
export function isSandboxPty(ptyId: PtyId): boolean {
  return activeSandboxPtys.has(ptyId);
}

/**
 * Write data to a sandbox PTY
 */
export function writeSandboxPty(ptyId: PtyId, data: string): void {
  const managed = activeSandboxPtys.get(ptyId);
  if (managed) {
    managed.process.write(data);
  }
}

/**
 * Resize a sandbox PTY
 */
export function resizeSandboxPty(ptyId: PtyId, cols: number, rows: number): void {
  const managed = activeSandboxPtys.get(ptyId);
  if (managed) {
    managed.process.resize(cols, rows);
  }
}

/**
 * Kill a sandbox PTY
 */
export function killSandboxPty(ptyId: PtyId): void {
  const managed = activeSandboxPtys.get(ptyId);
  if (!managed) return;

  try {
    process.kill(-managed.process.pid, 'SIGTERM');
  } catch {
    try {
      managed.process.kill();
    } catch {
      // Ignore
    }
  }
  activeSandboxPtys.delete(ptyId);
}

/**
 * Get active sandbox sessions (for restoration after renderer reload)
 */
export function getActiveSandboxSessions(): ActiveSession[] {
  return Array.from(activeSandboxPtys.entries()).map(([ptyId, managed]) => ({
    ptyId,
    projectPath: managed.projectPath,
    command: managed.command,
    label: managed.label,
    taskId: managed.taskId,
    worktreePath: managed.worktreePath,
    isRunner: managed.isRunner,
    parentPtyId: managed.parentPtyId,
    sandboxed: true,
  }));
}

/**
 * Reconnect to an existing sandbox PTY after renderer reload.
 * Updates the window reference and returns buffered output for replay.
 */
export function reconnectSandboxPty(
  ptyId: PtyId,
  window: BrowserWindow,
): { success: boolean; bufferedOutput?: string; error?: string } {
  const managed = activeSandboxPtys.get(ptyId);
  if (!managed) {
    return { success: false, error: `Sandbox PTY ${ptyId} not found` };
  }

  currentWindow = window;
  const bufferedOutput = managed.outputChunks.join('');
  return { success: true, bufferedOutput };
}

/**
 * Clean up all sandboxed PTYs (called on app quit)
 */
export function cleanupSandboxPtys(): void {
  for (const [, managed] of activeSandboxPtys) {
    try {
      process.kill(-managed.process.pid, 'SIGTERM');
    } catch {
      try {
        managed.process.kill();
      } catch {
        // Ignore errors during cleanup
      }
    }
  }
  activeSandboxPtys.clear();
}
