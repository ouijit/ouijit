/**
 * Production {@link SessionPtyBackend} (task #462).
 *
 * Spawns the live process in-process via node-pty, reusing
 * {@link createShellProcess} so durable sessions get the exact same hook-env
 * injection and shell integration as the renderer-facing PTY path. This is the
 * "in-process" durability slice: processes are children of the main process, so
 * they survive a renderer reload but not a full quit. A later slice swaps this
 * for a detached daemon without touching the manager — the seam is this file.
 */
import { generateId } from '../utils/ids';
import { createShellProcess } from '../ptyManager';
import { clearHookStatus } from '../hookServer';
import { revokeToken } from '../apiAuth';
import { getLogger } from '../logger';
import type { BackendHandlers, BackendPty, BackendSpawnInput, SessionPtyBackend } from './backend';

const backendLog = getLogger().scope('sessions:backend');

/** Grace period before escalating SIGTERM to SIGKILL, mirroring ptyManager. */
const SIGKILL_GRACE = 3000;

export class NodePtyBackend implements SessionPtyBackend {
  spawn(input: BackendSpawnInput, handlers: BackendHandlers): BackendPty {
    const ptyId = generateId('pty');
    const { process: ptyProcess } = createShellProcess(ptyId, {
      cwd: input.cwd,
      projectPath: input.cwd,
      command: input.command || undefined,
      cols: input.cols,
      rows: input.rows,
      taskId: input.taskId ?? undefined,
      worktreePath: input.worktreePath ?? undefined,
      sandboxed: input.sandboxed,
    });

    backendLog.info('spawned', { ptyId, sessionId: input.sessionId, pid: ptyProcess.pid });

    ptyProcess.onData((data: string) => handlers.onData(data));
    ptyProcess.onExit(({ exitCode }) => {
      backendLog.info('exited', { ptyId, sessionId: input.sessionId, exitCode });
      clearHookStatus(ptyId);
      revokeToken(ptyId);
      handlers.onExit(exitCode);
    });

    return {
      ptyId,
      write: (data: string) => ptyProcess.write(data),
      resize: (cols: number, rows: number) => ptyProcess.resize(cols, rows),
      kill: () => killProcessGroup(ptyId, ptyProcess.pid, () => ptyProcess.kill()),
    };
  }
}

/**
 * Kill the whole process group (negative pid) so child processes (dev servers,
 * watchers) die with the shell, escalating to SIGKILL after a grace period.
 * Falls back to node-pty's own kill when the group signal can't be delivered.
 */
function killProcessGroup(ptyId: string, pid: number, fallbackKill: () => void): void {
  backendLog.info('killing', { ptyId, pid });
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      fallbackKill();
    } catch {
      // Already dead.
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already dead.
    }
  }, SIGKILL_GRACE);
}
