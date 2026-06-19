import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { PtyId, PtySpawnOptions, PtySpawnResult } from './types';
import { generateId } from './utils/ids';
import { getApiPort, getWrapperBinDir, clearHookStatus, clearAllHookStatuses } from './hookServer';
import { getShellIntegrationDir, resolveShellIntegration } from './shellIntegration';
import { getLogger } from './logger';
import { getUserDataPath, getCliPath } from './paths';
import { issueToken, revokeToken, revokeAllTokens } from './apiAuth';

const ptyLog = getLogger().scope('pty');

/**
 * Builds the command string to run in the spawned shell.
 *
 * Env vars (OUIJIT_* and any custom vars from the caller) are passed to the
 * PTY process as real environment variables, so the shell expands $VAR /
 * ${VAR} references itself when it parses the command.
 *
 * The command must NOT be pre-substituted with the raw env values. Splicing a
 * value into the command text lets the shell re-parse and re-evaluate any
 * shell metacharacters it contains (backticks, $(), quotes) — e.g. a task
 * named ``Add `.DS_Store` in .gitignore`` would have its backticks executed
 * as a command. Genuine env-var expansion inside double quotes keeps such
 * characters literal.
 *
 * `env` is accepted (and ignored) so callers can document that those values
 * reach the shell as environment variables rather than as command text.
 */
export function buildCommandString(command: string | undefined, _env?: Record<string, string> | undefined): string {
  return command || '';
}

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
  // Per-tick IPC coalescing — heavy output (find /, builds, log tails) emits
  // many small chunks; sending each as its own IPC message saturates the
  // renderer with serialization work and stutters the UI. We collect chunks
  // and flush once per Node event-loop tick.
  pendingForwardChunks: string[];
  forwardFlushScheduled: boolean;
  // Terminal state tracking for accurate reconnection replay
  isAltScreen: boolean;
  lastCols: number;
  lastRows: number;
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
 * Flush any pending forwarded chunks for a PTY as a single concatenated IPC
 * message. Safe to call when nothing is pending or when no renderer is attached.
 */
function flushPendingForward(ptyId: PtyId, channel: string): void {
  const managed = activePtys.get(ptyId);
  if (!managed) return;
  managed.forwardFlushScheduled = false;
  if (managed.pendingForwardChunks.length === 0) return;
  if (!canSendToRenderer()) {
    // Drop the queue if there's no renderer to receive it; the chunks are
    // already retained in `outputChunks` for reconnection replay.
    managed.pendingForwardChunks.length = 0;
    return;
  }
  const payload =
    managed.pendingForwardChunks.length === 1 ? managed.pendingForwardChunks[0] : managed.pendingForwardChunks.join('');
  managed.pendingForwardChunks.length = 0;
  currentWindow!.webContents.send(channel, payload);
}

/**
 * Handle PTY output: always buffer for history, and forward to renderer if connected.
 *
 * Forwarding is coalesced once per Node event-loop tick via `setImmediate`. A
 * heavy command (build, `find /`, log tail) can emit many small data events
 * per millisecond; sending each as its own IPC was saturating the renderer
 * with serialization + xterm side-effect work, stuttering kanban drag and
 * other UI animations.
 */
function handlePtyOutput(ptyId: PtyId, channel: string, data: string): void {
  const managed = activePtys.get(ptyId);
  if (!managed) return;

  // Track alternate screen mode (smcup/rmcup) for reconnection replay
  if (data.includes('\x1b[?1049h') || data.includes('\x1b[?47h')) {
    managed.isAltScreen = true;
  }
  if (data.includes('\x1b[?1049l') || data.includes('\x1b[?47l')) {
    managed.isAltScreen = false;
  }

  // Array-based history buffer (preserved per-chunk for accurate replay)
  managed.outputChunks.push(data);
  managed.outputSize += data.length;
  while (managed.outputSize > managed.maxBufferSize && managed.outputChunks.length > 1) {
    const removed = managed.outputChunks.shift()!;
    managed.outputSize -= removed.length;
  }

  // Coalesce forwards to the renderer
  managed.pendingForwardChunks.push(data);
  if (!managed.forwardFlushScheduled) {
    managed.forwardFlushScheduled = true;
    setImmediate(() => flushPendingForward(ptyId, channel));
  }
}

/**
 * Spawn a new PTY with the user's shell
 */
export async function spawnPty(options: PtySpawnOptions, window: BrowserWindow): Promise<PtySpawnResult> {
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
    finalEnv['OUIJIT_API_TOKEN'] = issueToken(ptyId, 'host');

    // Shell integration: wrapper dir + integration dir for PATH fix scripts
    const wrapperBinDir = getWrapperBinDir();
    const shellIntegrationDir = getShellIntegrationDir();
    finalEnv['OUIJIT_WRAPPER_DIR'] = wrapperBinDir;
    finalEnv['OUIJIT_SHELL_INTEGRATION_DIR'] = shellIntegrationDir;

    // Prepend wrapper bin dir so `claude` and `ouijit` resolve to our wrappers first
    finalEnv['PATH'] = `${wrapperBinDir}:${finalEnv['PATH'] || ''}`;

    // Inject CLI env vars so the `ouijit` wrapper can find the bundled CLI
    finalEnv['OUIJIT_USER_DATA'] = getUserDataPath();
    const cliPath = getCliPath();
    if (cliPath) finalEnv['OUIJIT_CLI_PATH'] = cliPath;

    // Build the command string to run in the spawned shell
    const expandedCommand = buildCommandString(options.command, options.env);

    // Resolve the shell's integration provider (zsh/bash/fish, or a fail-open
    // POSIX fallback for anything else) and let it build the spawn recipe: the
    // binary to exec, its argv, and any env vars it needs (e.g. zsh's ZDOTDIR).
    const integration = resolveShellIntegration(shell);
    const launch = integration.launch({
      shell,
      integrationDir: shellIntegrationDir,
      command: expandedCommand,
      zdotdir: finalEnv['ZDOTDIR'],
    });
    if (launch.env) {
      Object.assign(finalEnv, launch.env);
    }

    const ptyProcess = pty.spawn(launch.file, launch.args, {
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
      pendingForwardChunks: [],
      forwardFlushScheduled: false,
      isAltScreen: false,
      lastCols: options.cols || 80,
      lastRows: options.rows || 24,
    };

    activePtys.set(ptyId, managed);
    ptyLog.info('spawned', {
      ptyId,
      shell,
      shellIntegration: integration.id,
      spawnFile: launch.file,
      cwd: options.cwd,
      pid: ptyProcess.pid,
      label,
    });

    ptyProcess.onData((data: string) => {
      handlePtyOutput(ptyId, `pty:data:${ptyId}`, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      ptyLog.info('exited', { ptyId, exitCode });
      // Drain any output buffered in the same tick as the exit so the user
      // sees the final lines before the exit message.
      flushPendingForward(ptyId, `pty:data:${ptyId}`);
      if (canSendToRenderer()) {
        currentWindow!.webContents.send(`pty:exit:${ptyId}`, exitCode);
      }
      activePtys.delete(ptyId);
      clearHookStatus(ptyId);
      revokeToken(ptyId);
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
  window: BrowserWindow,
): {
  success: boolean;
  bufferedOutput?: string;
  isAltScreen?: boolean;
  lastCols?: number;
  lastRows?: number;
  error?: string;
} {
  const managed = activePtys.get(ptyId);
  if (!managed) {
    return { success: false, error: `PTY ${ptyId} not found` };
  }

  // Update window reference
  currentWindow = window;

  // Drop any chunks queued for forwarding — `outputChunks` already contains
  // them, and the renderer replays the full history below. Without this clear,
  // a scheduled setImmediate flush would re-send those same chunks after the
  // replay, producing duplicated output on reconnect.
  managed.pendingForwardChunks.length = 0;

  // Join chunks for replay (only done on reconnection, not per data event)
  const bufferedOutput = managed.outputChunks.join('');

  return {
    success: true,
    bufferedOutput,
    isAltScreen: managed.isAltScreen,
    lastCols: managed.lastCols,
    lastRows: managed.lastRows,
  };
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

/** Get the number of active PTY sessions */
export function getActiveSessionCount(): number {
  return activePtys.size;
}

/**
 * Update a PTY's display label (user renamed the terminal card). Keeps the
 * managed record in sync so `getActiveSessions` — and therefore the reconnect
 * path after a renderer reload — restores the renamed label, not the original.
 */
export function setPtyLabel(ptyId: PtyId, label: string): void {
  const managed = activePtys.get(ptyId);
  if (managed) managed.label = label;
}

/**
 * Sandbox PTYs are tracked in src/lima/spawn.ts in their own map — they never
 * enter `activePtys`. But hookServer / setPlanPath / `task current` need a
 * single source of truth for "is this ptyId live?" and "what task does this
 * ptyId belong to?" across both kinds. spawn.ts registers / unregisters ids
 * here over its lifecycle. Direct import would cycle (spawn already imports
 * from hookServer), hence this narrow one-way hook.
 */
interface SandboxPtyInfo {
  projectPath: string;
  taskId?: number;
}
const sandboxPtyInfo = new Map<PtyId, SandboxPtyInfo>();

export function registerSandboxPty(ptyId: PtyId, info: SandboxPtyInfo): void {
  sandboxPtyInfo.set(ptyId, info);
}

export function unregisterSandboxPty(ptyId: PtyId): void {
  sandboxPtyInfo.delete(ptyId);
}

/** Check if a PTY is currently active — covers host and sandbox PTYs. */
export function isPtyActive(ptyId: PtyId): boolean {
  return activePtys.has(ptyId) || sandboxPtyInfo.has(ptyId);
}

/**
 * Resolve the task context for a ptyId — covers host and sandbox PTYs.
 * Returns null when the pty isn't live or isn't bound to a task.
 */
export function getPtyTaskContext(ptyId: PtyId): { projectPath: string; taskId: number } | null {
  const host = activePtys.get(ptyId);
  if (host && host.taskId != null) {
    return { projectPath: host.projectPath, taskId: host.taskId };
  }
  const sandbox = sandboxPtyInfo.get(ptyId);
  if (sandbox && sandbox.taskId != null) {
    return { projectPath: sandbox.projectPath, taskId: sandbox.taskId };
  }
  return null;
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
    managed.lastCols = cols;
    managed.lastRows = rows;
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
  clearHookStatus(ptyId);
  revokeToken(ptyId);
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
  clearAllHookStatuses();
  revokeAllTokens();
}
