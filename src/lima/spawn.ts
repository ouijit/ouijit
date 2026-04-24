import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { PtySpawnOptions, PtySpawnResult, PtyId } from '../types';
import { registerSandboxPty, unregisterSandboxPty, type ActiveSession } from '../ptyManager';
import { generateId } from '../utils/ids';
import { buildLimactlHostEnv, ensureRunning, getLimactlPath } from './manager';
import { getApiPort, HELPER_SCRIPT, buildVmHookSettings } from '../hookServer';
import { issueToken, revokeToken } from '../apiAuth';
import { getTaskByNumber } from '../db';
import { startSandboxView, watchSandboxRef, ffMergeSandboxToUser } from './sandboxSync';
import { getLogger } from '../logger';

const spawnLog = getLogger().scope('limaSpawn');

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
  /** Disposer for the sandbox-branch ref watcher, set for sandboxed tasks. */
  disposeRefWatcher?: () => void;
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
 *
 * The ouijit CLI reference file is deliberately not written into the
 * sandbox VM. The CLI would give an agent inside the VM task-management
 * powers (create non-sandboxed tasks, install hooks, change merge
 * targets) that amount to a lateral-movement path from VM to host.
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
    const sendStep = (step: { id: string; label: string; status: 'active' | 'done' }) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('lima:spawn-progress', step);
      }
    };
    const vmResult = await ensureRunning(projectPath, sendStep);
    if (!vmResult.success) {
      return { success: false, error: vmResult.error || 'Failed to start sandbox VM' };
    }

    const instanceName = vmResult.instanceName;
    sendStep({ id: 'shell', label: 'Launching shell…', status: 'active' });

    // Dual-worktree: if this terminal belongs to a sandboxed task, we don't
    // expose the user's worktree to the VM. Instead we materialize a second,
    // tracked-files-only worktree on a `T-N-sandbox` child branch under
    // `~/Ouijit/sandbox-views/<proj>/T-N` (mounted into the guest) and swap
    // the shell's cwd to it. The agent's commits ride on the sandbox branch;
    // a host-side ref watcher ff-merges them back onto the user branch.
    let guestCwd = options.cwd;
    let sandboxViewPath: string | undefined;
    let sandboxUserWorktreePath: string | undefined;
    let sandboxUserBranch: string | undefined;

    if (options.taskId != null) {
      const task = await getTaskByNumber(projectPath, options.taskId);
      if (!task) {
        return { success: false, error: `Sandboxed task ${options.taskId} not found for project` };
      }
      if (!task.branch) {
        return { success: false, error: `Sandboxed task ${options.taskId} has no branch` };
      }
      if (!task.worktreePath) {
        return { success: false, error: `Sandboxed task ${options.taskId} has no worktree path` };
      }
      sandboxUserWorktreePath = task.worktreePath;
      sandboxUserBranch = task.branch;
      try {
        const view = await startSandboxView(projectPath, options.taskId, task.branch);
        sandboxViewPath = view.path;
        guestCwd = view.path;
        spawnLog.info('sandbox view ready', {
          taskId: options.taskId,
          viewPath: view.path,
          branch: view.branch,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spawnLog.error('startSandboxView failed — refusing to spawn sandboxed terminal', {
          taskId: options.taskId,
          error: message,
        });
        return { success: false, error: `Failed to create sandbox-view worktree: ${message}` };
      }
    }

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
    const apiToken = issueToken(ptyId, 'sandbox');

    // Inject hook API env vars into the VM shell (host.lima.internal resolves to host)
    envExports += `export OUIJIT_PTY_ID='${ptyId}'\n`;
    envExports += `export OUIJIT_API_URL='http://host.lima.internal:${getApiPort()}'\n`;
    envExports += `export OUIJIT_API_TOKEN='${apiToken}'\n`;

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

    // Build env for the host-side limactl child process. Only keys limactl
    // and its SSH helper legitimately need — no blanket spread of
    // process.env. Guest-bound variables (options.env) are already
    // re-exported inside the VM via `envExports` above; they don't need
    // to sit on the host child.
    const ptyProcess = pty.spawn(getLimactlPath(), limactlArgs, {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      env: buildLimactlHostEnv(process.env),
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
    registerSandboxPty(ptyId, { projectPath, taskId: options.taskId });

    // Watch the sandbox branch ref so agent commits fast-forward onto the
    // user's branch. Fires per-PTY, not per-terminal-card; sharing the
    // watcher across PTYs would couple lifetimes unnecessarily.
    if (options.taskId != null && sandboxUserWorktreePath && sandboxViewPath && sandboxUserBranch) {
      const taskNumber = options.taskId;
      const userWorktreePath = sandboxUserWorktreePath;
      const userBranch = sandboxUserBranch;
      const watchProject = projectPath;
      managed.disposeRefWatcher = watchSandboxRef(watchProject, userBranch, () => {
        void ffMergeSandboxToUser(userWorktreePath, userBranch).then((result) => {
          if (result.ok === false && result.reason === 'non-ff') {
            if (currentWindow && !currentWindow.isDestroyed()) {
              currentWindow.webContents.send('sandbox:diverged', {
                taskNumber,
                userWorktreePath,
                sandboxViewPath,
              });
            }
          }
        });
      });
    }

    ptyProcess.onData((data: string) => {
      handleOutput(ptyId, `pty:data:${ptyId}`, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      try {
        if (currentWindow && !currentWindow.isDestroyed()) {
          currentWindow.webContents.send(`pty:exit:${ptyId}`, exitCode);
        }
      } finally {
        const m = activeSandboxPtys.get(ptyId);
        m?.disposeRefWatcher?.();
        activeSandboxPtys.delete(ptyId);
        unregisterSandboxPty(ptyId);
        revokeToken(ptyId);
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

  managed.disposeRefWatcher?.();
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
  unregisterSandboxPty(ptyId);
  revokeToken(ptyId);
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
  for (const [ptyId, managed] of activeSandboxPtys) {
    managed.disposeRefWatcher?.();
    try {
      process.kill(-managed.process.pid, 'SIGTERM');
    } catch {
      try {
        managed.process.kill();
      } catch {
        // Ignore errors during cleanup
      }
    }
    unregisterSandboxPty(ptyId);
    revokeToken(ptyId);
  }
  activeSandboxPtys.clear();
}
