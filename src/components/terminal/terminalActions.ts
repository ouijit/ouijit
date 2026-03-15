/**
 * Terminal lifecycle actions — spawn, close, reconnect.
 * These are imperative functions that create OuijitTerminal instances
 * and register them in both the instance registry and the Zustand store.
 */

import type { PtySpawnOptions, RunConfig, WorktreeInfo, ActiveSession } from '../../types';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { useAppStore, staleGuard } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { OuijitTerminal, terminalInstances, resolveTerminalLabel, type SummaryType } from './terminalReact';
import log from 'electron-log/renderer';

const actionsLog = log.scope('terminalActions');

// ── Types ────────────────────────────────────────────────────────────

export interface AddProjectTerminalOptions {
  useWorktree?: boolean;
  existingWorktree?: WorktreeInfo & { prompt?: string; sandboxed?: boolean };
  worktreeName?: string;
  worktreePrompt?: string;
  worktreeBranchName?: string;
  sandboxed?: boolean;
  taskId?: number;
  skipAutoHook?: boolean;
  background?: boolean;
}

// ── Add a terminal to the system ─────────────────────────────────────

function registerTerminal(
  term: OuijitTerminal,
  projectPath: string,
  initial: Partial<TerminalDisplayState>,
  background?: boolean,
): void {
  const ptyId = term.ptyId;

  // Add to instance registry
  terminalInstances.set(ptyId, term);

  // Set project name getter for notifications
  term.setProjectNameGetter(() => useAppStore.getState().activeProjectData?.name ?? 'Ouijit');

  // Add to Zustand store
  useTerminalStore.getState().addTerminal(projectPath, ptyId, initial);

  // Activate last unless background
  if (!background) {
    useTerminalStore.getState().activateLast(projectPath);
    requestAnimationFrame(() => term.xterm.focus());
  }
}

// ── Spawn a new project terminal ─────────────────────────────────────

export async function addProjectTerminal(
  projectPath: string,
  runConfig?: RunConfig,
  options?: AddProjectTerminalOptions,
): Promise<boolean> {
  const version = useAppStore.getState()._version;
  const isStale = staleGuard(version);

  let terminalCwd = projectPath;
  let worktreeInfo: (WorktreeInfo & { prompt?: string }) | undefined = options?.existingWorktree;
  let taskPrompt: string | undefined = options?.existingWorktree?.prompt;

  // Create worktree if needed
  if (options?.useWorktree && !worktreeInfo) {
    useTerminalStore.getState().setLoadingLabel(options.worktreeName || 'New task');

    const result = await window.api.task.createAndStart(
      projectPath,
      options.worktreeName,
      options.worktreePrompt,
      options.worktreeBranchName,
    );

    useTerminalStore.getState().setLoadingLabel(null);

    if (isStale()) return false;

    if (!result.success || !result.task || !result.worktreePath) {
      useProjectStore.getState().addToast(result.error || 'Failed to create task', 'error');
      return false;
    }

    worktreeInfo = {
      path: result.worktreePath,
      branch: result.task.branch || '',
      createdAt: result.task.createdAt,
    };
    taskPrompt = options.worktreePrompt;

    if (options?.sandboxed !== undefined) {
      await window.api.task.setSandboxed(projectPath, result.task.taskNumber, options.sandboxed);
    }
    if (!options) options = {};
    options.taskId = result.task.taskNumber;
    useProjectStore.getState().invalidateTaskList();
  }

  if (worktreeInfo) {
    terminalCwd = worktreeInfo.path;
  }

  // Look up current task name
  let taskName: string | undefined;
  if (options?.taskId != null) {
    const task = await window.api.task.getByNumber(projectPath, options.taskId);
    taskName = task?.name;
  }

  if (isStale()) return false;

  const label = resolveTerminalLabel(taskName, worktreeInfo?.branch, runConfig?.name);
  const command = runConfig?.command;

  // Determine command to run
  let startCommand = command;
  let startEnv: Record<string, string> | undefined;

  if (worktreeInfo) {
    const isNewTask = options?.useWorktree && !options?.existingWorktree;
    const hookType = isNewTask ? 'start' : 'continue';

    startEnv = {
      OUIJIT_HOOK_TYPE: hookType,
      OUIJIT_PROJECT_PATH: projectPath,
      OUIJIT_WORKTREE_PATH: worktreeInfo.path,
      OUIJIT_TASK_BRANCH: worktreeInfo.branch,
      OUIJIT_TASK_NAME: label,
    };
    if (taskPrompt) {
      startEnv.OUIJIT_TASK_PROMPT = taskPrompt;
    }

    if (!runConfig && !options?.skipAutoHook) {
      const hooks = await window.api.hooks.get(projectPath);
      const hook = isNewTask ? hooks.start : hooks.continue;
      if (hook) {
        startCommand = hook.command;
      }
    }
  }

  if (isStale()) return false;

  // Check sandbox
  const limaStatus = await window.api.lima.status(projectPath);
  const taskSandboxed = options?.sandboxed ?? options?.existingWorktree?.sandboxed;
  const useSandbox = limaStatus.available && taskSandboxed === true;

  // Create OuijitTerminal
  const term = new OuijitTerminal({
    projectPath,
    command: startCommand,
    label,
    sandboxed: useSandbox,
    taskId: options?.taskId ?? null,
    taskPrompt,
    worktreePath: worktreeInfo?.path,
    worktreeBranch: worktreeInfo?.branch,
  });

  // Open xterm into viewport element (not yet in DOM — React will attach via XTermContainer)
  term.openTerminal();

  // For sandbox: register early (before spawn) so the card shows
  const addedEarly = useSandbox;
  if (addedEarly) {
    registerTerminal(
      term,
      projectPath,
      {
        label,
        sandboxed: useSandbox,
        taskId: options?.taskId ?? null,
        worktreeBranch: worktreeInfo?.branch ?? null,
        diffPanelMode: term.diffPanelMode,
      },
      options?.background,
    );
  }

  // Spawn PTY
  const spawnOptions: PtySpawnOptions = {
    cwd: terminalCwd,
    projectPath,
    command: startCommand,
    cols: term.xterm.cols || 80,
    rows: term.xterm.rows || 24,
    label,
    taskId: options?.taskId,
    worktreePath: worktreeInfo?.path,
    env: startEnv,
    sandboxed: useSandbox,
  };

  try {
    const ptyId = await term.spawnPty(spawnOptions);

    if (isStale()) {
      if (ptyId) {
        window.api.pty.kill(ptyId);
        term.dispose();
      }
      return false;
    }

    if (!ptyId) {
      if (addedEarly) {
        setTimeout(() => {
          term.dispose();
          useTerminalStore.getState().removeTerminal(term.ptyId);
        }, 10_000);
      } else {
        setTimeout(() => term.dispose(), 10_000);
      }
      return false;
    }

    // If not added early, register now
    if (!addedEarly) {
      registerTerminal(
        term,
        projectPath,
        {
          label,
          sandboxed: useSandbox,
          taskId: options?.taskId ?? null,
          worktreeBranch: worktreeInfo?.branch ?? null,
          diffPanelMode: term.diffPanelMode,
        },
        options?.background,
      );
    }

    // Fetch initial git status and tags
    term.refreshGitStatus();
    term.loadTags();

    return true;
  } catch (error) {
    actionsLog.error('terminal spawn failed', { error: error instanceof Error ? error.message : String(error) });
    if (addedEarly) {
      useTerminalStore.getState().removeTerminal(term.ptyId);
    }
    term.dispose();
    return false;
  }
}

// ── Close a terminal ─────────────────────────────────────────────────

export function closeProjectTerminal(ptyId: string): void {
  const instance = terminalInstances.get(ptyId);
  if (instance) {
    instance.dispose();
  }
  useTerminalStore.getState().removeTerminal(ptyId);
}

// ── Reconnect to an orphaned PTY ─────────────────────────────────────

export async function reconnectTerminal(
  session: ActiveSession,
  opts: { worktreeBranch?: string; initialStatus?: SummaryType } = {},
): Promise<OuijitTerminal | null> {
  const term = new OuijitTerminal({
    ptyId: session.ptyId,
    projectPath: session.projectPath,
    command: session.command,
    label: session.label,
    sandboxed: !!session.sandboxed,
    taskId: session.taskId ?? null,
    worktreePath: session.worktreePath,
    worktreeBranch: opts.worktreeBranch,
    initialSummaryType: opts.initialStatus,
  });

  term.openTerminal();

  // Reconnect to existing PTY
  const result = await window.api.pty.reconnect(session.ptyId);
  if (!result.success) {
    term.dispose();
    return null;
  }

  // Replay buffered output
  term.replayBuffer(result.bufferedOutput, result.lastCols, result.isAltScreen);

  // Bind to PTY (wires data, input, exit, resize)
  term.bind(session.ptyId);

  // Force SIGWINCH
  term.forceSigwinch();

  // Register in store
  registerTerminal(term, session.projectPath, {
    label: session.label,
    sandboxed: !!session.sandboxed,
    taskId: session.taskId ?? null,
    worktreeBranch: opts.worktreeBranch ?? null,
    summaryType: opts.initialStatus ?? 'ready',
  });

  // Load tags and git status
  term.loadTags();
  term.refreshGitStatus();

  return term;
}

// ── Run hook as runner terminal ──────────────────────────────────────

export async function runDefaultInCard(ptyId: string): Promise<void> {
  const instance = terminalInstances.get(ptyId);
  if (!instance) return;

  const path = instance.projectPath;

  // Kill existing runner first
  if (instance.runner?.ptyId) {
    instance.killRunner();
  }

  const [hooks, settings] = await Promise.all([window.api.hooks.get(path), window.api.getProjectSettings(path)]);

  if (!hooks.run) {
    // TODO: Show hook config dialog (Phase 5)
    return;
  }

  const runHook = hooks.run;

  // Kill existing instances with same command
  if (settings.killExistingOnRun !== false) {
    killExistingCommandInstances(path, runHook.command);
  }

  // Set runner state on parent
  instance.runnerCommand = runHook.command;
  instance.runnerStatus = 'running';

  // Create runner terminal
  const runner = new OuijitTerminal({
    projectPath: path,
    label: runHook.name,
    isRunner: true,
  });

  runner.openTerminal();

  // Spawn PTY for the runner
  const cwd = instance.worktreePath || path;
  const spawnOptions: PtySpawnOptions = {
    cwd,
    projectPath: path,
    command: runHook.command,
    cols: 80,
    rows: 24,
    label: runHook.name,
    worktreePath: instance.worktreePath,
    isRunner: true,
    parentPtyId: instance.ptyId,
    env: {
      OUIJIT_HOOK_TYPE: 'run',
      OUIJIT_PROJECT_PATH: path,
      ...(instance.worktreePath && { OUIJIT_WORKTREE_PATH: instance.worktreePath }),
      ...(instance.worktreeBranch && { OUIJIT_TASK_BRANCH: instance.worktreeBranch }),
      ...(instance.label && { OUIJIT_TASK_NAME: instance.label }),
      ...(instance.taskPrompt && { OUIJIT_TASK_PROMPT: instance.taskPrompt }),
    },
  };

  try {
    const result = await window.api.pty.spawn(spawnOptions);

    if (!result.success || !result.ptyId) {
      runner.xterm.writeln(`\x1b[31mFailed to start runner: ${result.error || 'Unknown error'}\x1b[0m`);
      instance.runnerStatus = 'error';
      instance.pushDisplayState({ runnerStatus: 'error' });
      return;
    }

    // Register runner in instance registry
    terminalInstances.set(result.ptyId, runner);

    // Bind runner with custom data/exit handlers
    runner.bind(result.ptyId, {
      skipSideEffects: true,
      onData: (data) => {
        const oscMatches = data.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
        for (const match of oscMatches) {
          if (match[1]) {
            instance.runnerCommand = match[1];
            instance.pushDisplayState({ runnerStatus: instance.runnerStatus });
          }
        }
      },
      onExit: (exitCode) => {
        instance.runnerStatus = exitCode === 0 ? 'success' : 'error';
        instance.pushDisplayState({ runnerStatus: instance.runnerStatus });
      },
    });

    instance.setRunner(runner);
    instance.runnerPanelOpen = true;
    instance.pushDisplayState({
      runnerStatus: 'running',
      runnerPanelOpen: true,
    });
  } catch (error) {
    runner.xterm.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    instance.runnerStatus = 'error';
    instance.pushDisplayState({ runnerStatus: 'error' });
  }
}

// ── Kill existing command instances ──────────────────────────────────

function killExistingCommandInstances(projectPath: string, command: string): void {
  const store = useTerminalStore.getState();
  const ptyIds = store.terminalsByProject[projectPath] ?? [];

  // Kill runners with same command
  for (const id of ptyIds) {
    const instance = terminalInstances.get(id);
    if (instance?.runnerCommand === command) {
      instance.killRunner();
    }
  }

  // Close terminals running the same command (reverse order for index safety)
  for (let i = ptyIds.length - 1; i >= 0; i--) {
    const instance = terminalInstances.get(ptyIds[i]);
    if (instance?.command === command) {
      closeProjectTerminal(ptyIds[i]);
    }
  }
}

// ── Reconnect all orphaned sessions for a project ────────────────────

export async function reconnectOrphanedSessions(projectPath: string): Promise<void> {
  let sessions: ActiveSession[];
  try {
    sessions = await window.api.pty.getActiveSessions();
  } catch {
    return;
  }

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  if (projectSessions.length === 0) return;

  for (const session of projectSessions) {
    // Look up worktree branch if this is a task terminal
    let worktreeBranch: string | undefined;
    if (session.taskId != null) {
      const task = await window.api.task.getByNumber(projectPath, session.taskId);
      worktreeBranch = task?.branch;
    }

    // Check if terminal is running Claude (has hooks) — show as thinking
    const hookStatus = await window.api.claudeHooks.getStatus(session.ptyId);
    const initialStatus: SummaryType = hookStatus?.status === 'thinking' ? 'thinking' : 'ready';

    await reconnectTerminal(session, { worktreeBranch, initialStatus });
  }
}
