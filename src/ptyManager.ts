import * as path from 'node:path';
import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { PtyId, PtySpawnOptions, PtySpawnResult } from './types';
import { generateId } from './utils/ids';
import {
  getApiPort,
  getWrapperBinDir,
  getShellIntegrationDir,
  clearHookStatus,
  clearAllHookStatuses,
} from './hookServer';
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

/**
 * Builds the argv for the spawned shell when a startup command is present.
 *
 * The command runs via `-ic` then the shell execs into an interactive
 * session, which avoids the double-echo from writing to stdin.
 *
 * The command is spliced into the `-c` script verbatim: it is shell *code*
 * the shell must parse (so $VAR expands and the user's own quotes apply), not
 * a data string. It must NOT be quote-escaped — the `'\''` idiom is only
 * valid inside an enclosing single-quoted string, and here the command is
 * interpolated unquoted, so escaping it would corrupt any command containing
 * a single quote into an unterminated quote.
 */
export function buildCommandShellArgs(command: string, shell: string, shellIntegrationDir: string): string[] {
  const isZsh = shell.endsWith('/zsh') || shell === 'zsh';
  const isBash = shell.endsWith('/bash') || shell === 'bash';
  const prefix = 'export PATH="$OUIJIT_WRAPPER_DIR:$PATH"';

  // Wrap the user command in a subshell so a stray `exit` (a shell builtin,
  // not a child process) only terminates the subshell, not our outer zsh/bash.
  // Without this, a hook like `echo hi; exit 1` would nuke the outer shell
  // before we could `exec` into the interactive one. Subshell exit code is
  // captured into $? exactly like an inline command would be.
  const wrapped = `(${command})`;

  // Capture the subshell's exit code into an env var so it survives the
  // `exec` into the interactive shell — exec replaces the process and resets
  // $?, so without this the renderer would never learn the initial command's
  // exit code. The integration script reads OUIJIT_INITIAL_EXIT on first load
  // and emits OSC 133;D itself.
  const captureExit = 'export OUIJIT_INITIAL_EXIT=$?';

  if (isZsh) {
    return ['-ic', `${prefix}; ${wrapped}; ${captureExit}; ZDOTDIR="$OUIJIT_SHELL_INTEGRATION_DIR/zsh" exec ${shell}`];
  }
  if (isBash) {
    const rcfile = path.join(shellIntegrationDir, 'ouijit-bash-integration.bash');
    return ['-ic', `${prefix}; ${wrapped}; ${captureExit}; exec bash --rcfile ${rcfile}`];
  }
  // Fallback for other shells
  return ['-ic', `${prefix}; ${wrapped}; ${captureExit}; exec ${shell}`];
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
 * Build the spawned shell's environment and argv, then spawn the node-pty
 * process. Shared by {@link spawnPty} (the renderer-facing path) and the durable
 * session backend (src/sessions/nodePtyBackend.ts), so both get identical hook
 * env injection and shell integration. Pure process creation: no `activePtys`
 * bookkeeping, no renderer forwarding, no exit wiring — the caller owns those.
 *
 * Each call issues a host API token keyed to `ptyId`; the caller must revoke it
 * on exit (see {@link killPty} / the session backend).
 */
export function createShellProcess(
  ptyId: PtyId,
  options: PtySpawnOptions,
): { process: pty.IPty; command: string; label: string } {
  const shell = getDefaultShell();

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

  // If there's a command, run it via shell -c then exec into interactive shell
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
      shellArgs = buildCommandShellArgs(expandedCommand, shell, shellIntegrationDir);
    }
  } else if (isBash) {
    // --rcfile/--init-file: bash sources this instead of ~/.bashrc.
    // Our integration script sources .bashrc first, then fixes PATH.
    if (expandedCommand) {
      shellArgs = buildCommandShellArgs(expandedCommand, shell, shellIntegrationDir);
    } else {
      shellArgs = ['--init-file', path.join(shellIntegrationDir, 'ouijit-bash-integration.bash')];
    }
  } else if (expandedCommand) {
    shellArgs = buildCommandShellArgs(expandedCommand, shell, shellIntegrationDir);
  }

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: options.cols || 80,
    rows: options.rows || 24,
    cwd: options.cwd,
    env: finalEnv,
  });

  const label = options.label || expandedCommand || 'Shell';
  return { process: ptyProcess, command: expandedCommand, label };
}

/**
 * Spawn a new PTY with the user's shell
 */
export async function spawnPty(options: PtySpawnOptions, window: BrowserWindow): Promise<PtySpawnResult> {
  try {
    const ptyId = generateId('pty');

    // Store window reference
    currentWindow = window;

    const { process: ptyProcess, command: expandedCommand, label } = createShellProcess(ptyId, options);
    const shell = getDefaultShell();

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
    ptyLog.info('spawned', { ptyId, shell, cwd: options.cwd, pid: ptyProcess.pid, label });

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
