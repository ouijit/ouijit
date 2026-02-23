import * as path from 'node:path';
import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { PtyId, PtySpawnOptions, PtySpawnResult } from './types';
import { generateId } from './utils/ids';
import { getApiPort, getWrapperBinDir, getShellIntegrationDir } from './hookServer';
import log from './log';

const ptyLog = log.scope('pty');

interface ManagedPty {
  process: pty.IPty;
  projectPath: string;
  command: string;
  label: string;
  taskId?: number;
  worktreePath?: string;
  sandboxed: boolean;
  // Runner identification
  isRunner: boolean;
  parentPtyId?: PtyId;
  // Array-based buffer for scroll history preservation (avoids string concatenation churn)
  outputChunks: string[];
  outputSize: number;
  maxBufferSize: number;
}

export interface ActiveSession {
  ptyId: PtyId;
  projectPath: string;
  command: string;
  label: string;
  taskId?: number;
  worktreePath?: string;
  isRunner?: boolean;
  parentPtyId?: PtyId;
  sandboxed?: boolean;
}

const activePtys = new Map<PtyId, ManagedPty>();
let currentWindow: BrowserWindow | null = null;

// Maximum bytes to buffer for scroll history preservation (100KB)
const MAX_BUFFER_SIZE = 100 * 1024;
const SIGKILL_GRACE = 3000;

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * Set the current window for IPC communication
 * Called when renderer connects/reconnects
 */
export function setWindow(window: BrowserWindow): void {
  currentWindow = window;
}

/**
 * Check if we can send to the renderer
 */
function canSendToRenderer(): boolean {
  return currentWindow !== null && !currentWindow.isDestroyed();
}

/**
 * Handle PTY output: always buffer for history, and forward to renderer if connected
 */
function handlePtyOutput(ptyId: PtyId, channel: string, data: string): void {
  const managed = activePtys.get(ptyId);
  if (!managed) return;

  // Array-based buffering to avoid string concatenation churn
  managed.outputChunks.push(data);
  managed.outputSize += data.length;

  // Trim from front when over limit
  while (managed.outputSize > managed.maxBufferSize && managed.outputChunks.length > 1) {
    const removed = managed.outputChunks.shift()!;
    managed.outputSize -= removed.length;
  }

  // Forward to renderer if available
  if (canSendToRenderer()) {
    currentWindow!.webContents.send(channel, data);
  }
}

/**
 * Spawn a new PTY with the user's shell
 */
export async function spawnPty(
  options: PtySpawnOptions,
  window: BrowserWindow
): Promise<PtySpawnResult> {
  try {
    const ptyId = generateId('pty');
    const shell = getDefaultShell();

    // Store window reference
    currentWindow = window;

    // Build environment: start with process.env, add our vars, then custom env
    // Filter out undefined values which can cause issues with node-pty
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
    // Add custom env vars (these take precedence)
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (value !== undefined) {
          finalEnv[key] = value;
        }
      }
    }

    // Inject hook API env vars so Claude Code hooks can reach us
    finalEnv['OUIJIT_PTY_ID'] = ptyId;
    finalEnv['OUIJIT_API_URL'] = `http://127.0.0.1:${getApiPort()}`;

    // Shell integration: wrapper dir + integration dir for PATH fix scripts
    const wrapperBinDir = getWrapperBinDir();
    const shellIntegrationDir = getShellIntegrationDir();
    finalEnv['OUIJIT_WRAPPER_DIR'] = wrapperBinDir;
    finalEnv['OUIJIT_SHELL_INTEGRATION_DIR'] = shellIntegrationDir;

    // Prepend wrapper bin dir so `claude` resolves to our wrapper first
    finalEnv['PATH'] = `${wrapperBinDir}:${finalEnv['PATH'] || ''}`;

    // Expand environment variables in the command if provided
    let expandedCommand = options.command || '';
    if (options.command && options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        // Replace $VAR and ${VAR} patterns
        expandedCommand = expandedCommand.replace(
          new RegExp(`\\$\\{${key}\\}|\\$${key}\\b`, 'g'),
          value
        );
      }
    }

    // If there's a command, run it via shell -c then exec into interactive shell
    // This avoids the double-echo issue from writing to stdin
    let shellArgs: string[] = [];

    const isZsh = shell.endsWith('/zsh') || shell === 'zsh';
    const isBash = shell.endsWith('/bash') || shell === 'bash';

    if (isZsh) {
      // ZDOTDIR trick: zsh sources $ZDOTDIR/.zshenv first. Our bootstrap
      // restores the real ZDOTDIR, sources user's .zshenv, then registers
      // precmd/preexec hooks that re-fix PATH after all init files run.
      finalEnv['OUIJIT_ZSH_ZDOTDIR'] = finalEnv['ZDOTDIR'] || '';
      finalEnv['ZDOTDIR'] = path.join(shellIntegrationDir, 'zsh');

      if (expandedCommand) {
        const escapedCmd = expandedCommand.replace(/'/g, "'\\''");
        shellArgs = ['-ic', `export PATH="$OUIJIT_WRAPPER_DIR:$PATH"; ${escapedCmd}; exec ${shell}`];
      }
    } else if (isBash) {
      // --rcfile/--init-file: bash sources this instead of ~/.bashrc.
      // Our integration script sources .bashrc first, then fixes PATH.
      const rcfile = path.join(shellIntegrationDir, 'ouijit-bash-integration.bash');

      if (expandedCommand) {
        const escapedCmd = expandedCommand.replace(/'/g, "'\\''");
        shellArgs = ['-ic', `export PATH="$OUIJIT_WRAPPER_DIR:$PATH"; ${escapedCmd}; exec bash --rcfile ${rcfile}`];
      } else {
        shellArgs = ['--init-file', rcfile];
      }
    } else if (expandedCommand) {
      // Fallback for other shells
      const escapedCmd = expandedCommand.replace(/'/g, "'\\''");
      shellArgs = ['-ic', `export PATH="$OUIJIT_WRAPPER_DIR:$PATH"; ${escapedCmd}; exec ${shell}`];
    }

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      env: finalEnv,
    });

    const label = options.label || expandedCommand || 'Shell';

    const managed: ManagedPty = {
      process: ptyProcess,
      projectPath: options.projectPath || options.cwd,
      command: expandedCommand,
      label,
      taskId: options.taskId,
      worktreePath: options.worktreePath,
      sandboxed: options.sandboxed || false,
      isRunner: options.isRunner || false,
      parentPtyId: options.parentPtyId,
      outputChunks: [],
      outputSize: 0,
      maxBufferSize: MAX_BUFFER_SIZE,
    };

    activePtys.set(ptyId, managed);
    ptyLog.info('spawned', { ptyId, shell, cwd: options.cwd, pid: ptyProcess.pid, label });

    ptyProcess.onData((data: string) => {
      handlePtyOutput(ptyId, `pty:data:${ptyId}`, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      ptyLog.info('exited', { ptyId, exitCode });
      if (canSendToRenderer()) {
        currentWindow!.webContents.send(`pty:exit:${ptyId}`, exitCode);
      }
      activePtys.delete(ptyId);
    });

    return { success: true, ptyId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to spawn PTY',
    };
  }
}

/**
 * Reconnect to an existing PTY after renderer reload
 * Returns buffered output (full scroll history) for replay
 */
export function reconnectPty(
  ptyId: PtyId,
  window: BrowserWindow
): { success: boolean; bufferedOutput?: string; error?: string } {
  const managed = activePtys.get(ptyId);
  if (!managed) {
    return { success: false, error: `PTY ${ptyId} not found` };
  }

  // Update window reference
  currentWindow = window;

  // Join chunks for replay (only done on reconnection, not per data event)
  const bufferedOutput = managed.outputChunks.join('');

  return { success: true, bufferedOutput };
}

/**
 * Get list of active sessions (for restoration after renderer reload)
 */
export function getActiveSessions(): ActiveSession[] {
  return Array.from(activePtys.entries()).map(([ptyId, managed]) => ({
    ptyId,
    projectPath: managed.projectPath,
    command: managed.command,
    label: managed.label,
    taskId: managed.taskId,
    worktreePath: managed.worktreePath,
    isRunner: managed.isRunner,
    parentPtyId: managed.parentPtyId,
    sandboxed: managed.sandboxed,
  }));
}

export function writeToPty(ptyId: PtyId, data: string): void {
  const managed = activePtys.get(ptyId);
  if (managed) {
    managed.process.write(data);
  }
}

export function resizePty(ptyId: PtyId, cols: number, rows: number): void {
  const managed = activePtys.get(ptyId);
  if (managed) {
    managed.process.resize(cols, rows);
  }
}

export function killPty(ptyId: PtyId): void {
  const managed = activePtys.get(ptyId);
  if (!managed) return;

  const pid = managed.process.pid;
  ptyLog.info('killing', { ptyId, pid });

  // Kill the entire process group (negative PID) to ensure child processes
  // (dev servers, watchers, etc.) are terminated — not just the shell.
  // node-pty uses forkpty() which creates a new session, so pid === pgid.
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Process group kill failed (already dead), fall back to node-pty kill
    try {
      managed.process.kill();
    } catch {
      // Already dead
    }
  }

  // Escalate to SIGKILL after grace period if process is still alive
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already dead
    }
  }, SIGKILL_GRACE);

  activePtys.delete(ptyId);
}

export function cleanupAllPtys(): void {
  for (const [, managed] of activePtys) {
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
  activePtys.clear();
}
