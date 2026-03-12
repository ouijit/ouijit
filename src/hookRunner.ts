/**
 * Hook execution module
 * Runs script hooks with timeout, output capture, and environment variables
 */

import { spawn } from 'node:child_process';
import type { ScriptHook } from './types';
import log from './log';

const hookLog = log.scope('hookRunner');

export interface HookResult {
  success: boolean;
  exitCode?: number;
  output?: string;
  error?: string;
}

export interface HookEnvironment {
  /** Main project path */
  projectPath: string;
  /** Task worktree path */
  worktreePath: string;
  /** Git branch name */
  taskBranch: string;
  /** Task display name */
  taskName: string;
  /** Optional prompt for the task */
  taskPrompt?: string;
}

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const SIGKILL_GRACE = 5000; // 5 seconds grace period before SIGKILL

/**
 * Execute a script hook
 */
export async function executeHook(
  hook: ScriptHook,
  cwd: string,
  env?: Partial<HookEnvironment>,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<HookResult> {
  const startTime = Date.now();
  hookLog.info('executing hook', { type: hook.type, command: hook.command, cwd });

  return new Promise((resolve) => {
    const outputChunks: string[] = [];
    let resolved = false;

    // Build environment variables
    const hookEnv: Record<string, string> = {
      ...process.env,
      OUIJIT_HOOK_TYPE: hook.type,
    };

    if (env?.projectPath) {
      hookEnv.OUIJIT_PROJECT_PATH = env.projectPath;
    }
    if (env?.worktreePath) {
      hookEnv.OUIJIT_WORKTREE_PATH = env.worktreePath;
    }
    if (env?.taskBranch) {
      hookEnv.OUIJIT_TASK_BRANCH = env.taskBranch;
    }
    if (env?.taskName) {
      hookEnv.OUIJIT_TASK_NAME = env.taskName;
    }
    if (env?.taskPrompt) {
      hookEnv.OUIJIT_TASK_PROMPT = env.taskPrompt;
    }

    // Spawn the process
    const child = spawn(hook.command, [], {
      cwd,
      env: hookEnv,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;

      child.kill('SIGTERM');

      // Escalate to SIGKILL after grace period if process still running
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore - process may have already exited
        }
      }, SIGKILL_GRACE);

      hookLog.warn('hook timed out', { type: hook.type, command: hook.command, elapsed: Date.now() - startTime });
      resolve({
        success: false,
        error: `Hook timed out after ${timeout / 1000} seconds`,
        output: outputChunks.join(''),
      });
    }, timeout);

    // Capture stdout
    child.stdout?.on('data', (data: Buffer) => {
      outputChunks.push(data.toString());
    });

    // Capture stderr
    child.stderr?.on('data', (data: Buffer) => {
      outputChunks.push(data.toString());
    });

    // Handle process exit
    child.on('close', (exitCode) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      hookLog.info('hook completed', {
        type: hook.type,
        command: hook.command,
        exitCode,
        elapsed: Date.now() - startTime,
      });
      resolve({
        success: exitCode === 0,
        exitCode: exitCode ?? undefined,
        output: outputChunks.join(''),
      });
    });

    // Handle spawn errors
    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      hookLog.error('hook spawn error', { type: hook.type, command: hook.command, error: err.message });
      resolve({
        success: false,
        error: err.message,
        output: outputChunks.join(''),
      });
    });
  });
}
