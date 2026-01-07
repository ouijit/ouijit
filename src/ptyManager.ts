import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { PtyId, PtySpawnOptions, PtySpawnResult } from './types';

interface ManagedPty {
  process: pty.IPty;
  projectPath: string;
  command: string;
}

const activePtys = new Map<PtyId, ManagedPty>();

function generatePtyId(): PtyId {
  return `pty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export function spawnPty(
  options: PtySpawnOptions,
  window: BrowserWindow
): PtySpawnResult {
  try {
    const ptyId = generatePtyId();
    const shell = getDefaultShell();

    const shellArgs = process.platform === 'win32'
      ? ['/c', options.command]
      : ['-c', options.command];

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      } as Record<string, string>,
    });

    activePtys.set(ptyId, {
      process: ptyProcess,
      projectPath: options.cwd,
      command: options.command,
    });

    ptyProcess.onData((data: string) => {
      if (!window.isDestroyed()) {
        window.webContents.send(`pty:data:${ptyId}`, data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (!window.isDestroyed()) {
        window.webContents.send(`pty:exit:${ptyId}`, exitCode);
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
