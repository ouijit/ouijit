import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { PtyId, PtySpawnOptions, PtySpawnResult } from './types';
import { generateId } from './utils/ids';

interface ManagedPty {
  process: pty.IPty;
  projectPath: string;
  command: string;
  label: string;
  isWorktree: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
  // Runner identification
  isRunner: boolean;
  parentPtyId?: PtyId;
  // Always buffer recent output for scroll history preservation
  outputBuffer: string;
  maxBufferSize: number;
}

export interface ActiveSession {
  ptyId: PtyId;
  projectPath: string;
  command: string;
  label: string;
  isWorktree: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
  isRunner?: boolean;
  parentPtyId?: PtyId;
}

const activePtys = new Map<PtyId, ManagedPty>();
let currentWindow: BrowserWindow | null = null;

// Maximum bytes to buffer for scroll history preservation (100KB)
const MAX_BUFFER_SIZE = 100 * 1024;

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

  // Always buffer output for scroll history preservation
  managed.outputBuffer += data;
  // Trim buffer if too large (keep the most recent output)
  if (managed.outputBuffer.length > managed.maxBufferSize) {
    managed.outputBuffer = managed.outputBuffer.slice(-managed.maxBufferSize);
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
    if (expandedCommand) {
      // Escape single quotes in the command for shell -c
      const escapedCmd = expandedCommand.replace(/'/g, "'\\''");
      shellArgs = ['-c', `${escapedCmd}; exec ${shell}`];
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
      isWorktree: options.isWorktree || false,
      worktreePath: options.worktreePath,
      worktreeBranch: options.worktreeBranch,
      isRunner: options.isRunner || false,
      parentPtyId: options.parentPtyId,
      outputBuffer: '',
      maxBufferSize: MAX_BUFFER_SIZE,
    };

    activePtys.set(ptyId, managed);

    ptyProcess.onData((data: string) => {
      handlePtyOutput(ptyId, `pty:data:${ptyId}`, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
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

  // Get the full buffered output (scroll history)
  // Don't clear the buffer - it persists across reconnections
  // so subsequent refreshes still have history
  const bufferedOutput = managed.outputBuffer;

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
    isWorktree: managed.isWorktree,
    worktreePath: managed.worktreePath,
    worktreeBranch: managed.worktreeBranch,
    isRunner: managed.isRunner,
    parentPtyId: managed.parentPtyId,
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
  if (managed) {
    managed.process.kill();
    activePtys.delete(ptyId);
  }
}

export function cleanupAllPtys(): void {
  for (const [, managed] of activePtys) {
    try {
      managed.process.kill();
    } catch {
      // Ignore errors during cleanup
    }
  }
  activePtys.clear();
}
