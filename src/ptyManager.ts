import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { PtyId, PtySpawnOptions, PtySpawnResult } from './types';
import { getCommandWithMise, isImportedProject } from './ouijit';

interface ManagedPty {
  process: pty.IPty;
  projectPath: string;
  command: string;
  label: string;
  isWorktree: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
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
}

const activePtys = new Map<PtyId, ManagedPty>();
let currentWindow: BrowserWindow | null = null;

// Maximum bytes to buffer for scroll history preservation (100KB)
const MAX_BUFFER_SIZE = 100 * 1024;

function generatePtyId(): PtyId {
  return `pty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

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
    const ptyId = generatePtyId();
    const shell = getDefaultShell();

    // Store window reference
    currentWindow = window;

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      } as Record<string, string>,
    });

    let finalCommand = options.command || '';
    const label = options.label || finalCommand || 'Shell';

    const managed: ManagedPty = {
      process: ptyProcess,
      projectPath: options.cwd,
      command: finalCommand,
      label,
      isWorktree: options.isWorktree || false,
      worktreePath: options.worktreePath,
      worktreeBranch: options.worktreeBranch,
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

    // If a command was provided, write it to the shell after a brief delay
    if (options.command) {
      const isImported = await isImportedProject(options.cwd);
      finalCommand = await getCommandWithMise(options.cwd, options.command, isImported);
      // Update the stored command
      managed.command = finalCommand;
      // Small delay to let shell initialize, then send the command
      setTimeout(() => {
        const m = activePtys.get(ptyId);
        if (m) {
          m.process.write(finalCommand + '\r');
        }
      }, 100);
    }

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
