/**
 * Terminal lifecycle actions — spawn, close, reconnect.
 * These are imperative functions that create OuijitTerminal instances
 * and register them in both the instance registry and the Zustand store.
 */

import type {
  PtySpawnOptions,
  RunConfig,
  WorktreeInfo,
  ActiveSession,
  RunnerScript,
  SnapshotTerminalUi,
} from '../../types';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { useCanvasStore, persistCanvas } from '../../stores/canvasStore';
import { useAppStore, staleGuard } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { OuijitTerminal, terminalInstances, resolveTerminalLabel, type SummaryType } from './terminalReact';
import { detectDevServerUrl } from '../webPreview/urlHelpers';
import log from 'electron-log/renderer';

const actionsLog = log.scope('terminalActions');

// ── Dev server URL detection ─────────────────────────────────────────

function applyDetectedWebPreviewUrl(parent: OuijitTerminal, url: string): void {
  // Respect manual edits: only overwrite if unset or the previous value was
  // itself auto-detected (e.g. Vite bumped to a new port).
  if (parent.webPreviewUrl && !parent.webPreviewUrlAutoDetected) return;
  if (parent.webPreviewUrl === url) return;
  parent.webPreviewUrl = url;
  parent.webPreviewUrlAutoDetected = true;
  parent.pushDisplayState({ webPreviewUrl: url });
}

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
  /** Apply persisted UI state (plan, web preview, runner panel) after spawn — for session restore. */
  initialUiState?: SnapshotTerminalUi;
  /** If set, the new terminal takes this synthetic loading slot's place via
   *  `rekeyTerminal` rather than being appended. Lets the kanban-drop loading
   *  card morph into the real terminal in the same stack position. */
  replaceLoadingId?: string;
}

// ── Apply persisted UI state from a session snapshot ────────────────

async function applyInitialUiState(term: OuijitTerminal, ui: SnapshotTerminalUi): Promise<void> {
  if (ui.planPath) {
    term.planPath = ui.planPath;
    term.planPanelOpen = true;
    term.pushDisplayState({ planPath: ui.planPath, planPanelOpen: true });
  }

  if (ui.webPreview?.url) {
    term.webPreviewUrl = ui.webPreview.url;
    term.webPreviewUrlAutoDetected = false;
    term.webPreviewPanelOpen = ui.webPreview.panelOpen;
    term.webPreviewFullWidth = ui.webPreview.fullWidth;
    term.webPreviewSplitRatio = ui.webPreview.splitRatio;
    term.pushDisplayState({
      webPreviewUrl: ui.webPreview.url,
      webPreviewPanelOpen: ui.webPreview.panelOpen,
      webPreviewFullWidth: ui.webPreview.fullWidth,
    });
  }

  if (ui.runner) {
    // Don't auto-respawn the previously-running script. A user's `npm run dev`
    // is benign to re-run, but a `Reset DB` or similar destructive script
    // would silently fire on Resume. Preserve the panel layout so the slot
    // is recognizable, and pre-load the script so one click on Run re-launches it.
    term.runnerFullWidth = ui.runner.fullWidth;
    term.runnerScript = { name: ui.runner.scriptName ?? '', command: ui.runner.scriptCommand };
  }
}

// ── Add a terminal to the system ─────────────────────────────────────

function registerTerminal(
  term: OuijitTerminal,
  projectPath: string,
  initial: Partial<TerminalDisplayState>,
  background?: boolean,
  replaceLoadingId?: string,
): void {
  const ptyId = term.ptyId;

  // Add to instance registry
  terminalInstances.set(ptyId, term);

  // Set project name getter for notifications
  term.setProjectNameGetter(() => useAppStore.getState().activeProjectData?.name ?? 'Ouijit');

  if (replaceLoadingId) {
    // Take the loading slot's place: same array position, same active index.
    // Clear the `isLoading` flag now that a real PTY backs the slot.
    useTerminalStore.getState().rekeyTerminal(replaceLoadingId, ptyId);
    useTerminalStore.getState().updateDisplay(ptyId, { ...initial, isLoading: false });
  } else {
    useTerminalStore.getState().addTerminal(projectPath, ptyId, initial);
  }

  // Add to canvas
  useCanvasStore.getState().ensureProject(projectPath);
  useCanvasStore.getState().addNode(projectPath, ptyId);
  persistCanvas(projectPath);

  // Activate last unless background. With a replaced loading slot the
  // active index already points at it — just focus the new xterm.
  if (!background) {
    if (!replaceLoadingId) {
      useTerminalStore.getState().activateLast(projectPath);
    }
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
      options.sandboxed,
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

    if (!options) options = {};
    options.taskId = result.task.taskNumber;
    useProjectStore.getState().invalidateTaskList();
  }

  if (worktreeInfo) {
    terminalCwd = worktreeInfo.path;
  }

  // Look up current task name and merge target
  let taskName: string | undefined;
  let mergeTarget: string | undefined;
  if (options?.taskId != null) {
    const task = await window.api.task.getByNumber(projectPath, options.taskId);
    taskName = task?.name;
    mergeTarget = task?.mergeTarget;
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
    mergeTarget,
  });

  // Open xterm into viewport element (not yet in DOM — React will attach via XTermContainer)
  term.openTerminal();

  // For sandbox: register early (before spawn) so the card shows. Skip if
  // we're replacing an existing loading slot — that slot is already the
  // visible card.
  const addedEarly = useSandbox && !options?.replaceLoadingId;
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

    // If not added early, register now (replacing the loading slot if given).
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
        options?.replaceLoadingId,
      );
    }

    // Fetch initial git status and tags
    term.refreshGitStatus();
    term.loadTags();

    if (options?.initialUiState) {
      await applyInitialUiState(term, options.initialUiState);
    }

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
  const projectPath = instance?.projectPath;
  if (instance) {
    instance.dispose();
  }
  useTerminalStore.getState().removeTerminal(ptyId);

  // Remove from canvas
  if (projectPath) {
    useCanvasStore.getState().removeNode(projectPath, ptyId);
    persistCanvas(projectPath);
  }
}

// ── Reconnect to an orphaned PTY ─────────────────────────────────────

export async function reconnectTerminal(
  session: ActiveSession,
  opts: { worktreeBranch?: string; mergeTarget?: string; initialStatus?: SummaryType } = {},
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
    mergeTarget: opts.mergeTarget,
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

  // Suppress PTY resizes while layout settles to avoid SIGWINCH → zsh % artifacts
  term.suppressResizeDuring(500);

  // Bind to PTY (wires data, input, exit, resize)
  term.bind(session.ptyId);

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

// ── Run hook or ad-hoc script as runner terminal ────────────────────

export async function spawnRunner(ptyId: string, script?: RunnerScript): Promise<void> {
  const instance = terminalInstances.get(ptyId);
  if (!instance) return;

  // Double-spawn guard
  if (instance._runnerSpawning) return;
  instance._runnerSpawning = true;

  try {
    await _spawnRunnerInner(instance, script);
  } finally {
    instance._runnerSpawning = false;
  }
}

async function _spawnRunnerInner(instance: OuijitTerminal, script?: RunnerScript): Promise<void> {
  const path = instance.projectPath;

  // Kill existing runner first
  if (instance.runner?.ptyId) {
    instance.killRunner();
  }

  // Determine command source: explicit script, or fall back to run hook
  let commandName: string;
  let commandStr: string;
  let hookType: string;

  if (script) {
    commandName = script.name;
    commandStr = script.command;
    hookType = 'script';
  } else {
    const [hooks, settings] = await Promise.all([window.api.hooks.get(path), window.api.getProjectSettings(path)]);
    if (!hooks.run) return;
    commandName = hooks.run.name;
    commandStr = hooks.run.command;
    hookType = 'run';

    // Kill existing instances with same command
    if (settings.killExistingOnRun !== false) {
      killExistingCommandInstances(path, commandStr);
    }
  }

  // For scripts, also check killExistingOnRun
  if (script) {
    const settings = await window.api.getProjectSettings(path);
    if (settings.killExistingOnRun !== false) {
      killExistingCommandInstances(path, commandStr);
    }
  }

  // Set runner state on parent
  instance.runnerCommand = commandStr;
  instance.runnerScript = script ?? null;
  instance.runnerStatus = 'running';

  // Create runner terminal
  const runner = new OuijitTerminal({
    projectPath: path,
    label: commandName,
    isRunner: true,
  });

  runner.openTerminal();

  // Spawn PTY for the runner
  const cwd = instance.worktreePath || path;
  const spawnOptions: PtySpawnOptions = {
    cwd,
    projectPath: path,
    command: commandStr,
    cols: 80,
    rows: 24,
    label: commandName,
    worktreePath: instance.worktreePath,
    isRunner: true,
    parentPtyId: instance.ptyId,
    env: {
      OUIJIT_HOOK_TYPE: hookType,
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
      instance.pushDisplayState({ runnerStatus: 'error', runnerScriptName: script?.name ?? null });
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
        const detected = detectDevServerUrl(data);
        if (detected) applyDetectedWebPreviewUrl(instance, detected);
      },
      onExit: (exitCode) => {
        instance.runnerStatus = exitCode === 0 ? 'success' : 'error';
        instance.pushDisplayState({ runnerStatus: instance.runnerStatus });
      },
    });

    instance.setRunner(runner);
    instance.pushDisplayState({
      runnerStatus: 'running',
      runnerScriptName: script?.name ?? null,
      runnerPanelOpen: true,
      runnerFullWidth: true,
    });
  } catch (error) {
    runner.xterm.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    instance.runnerStatus = 'error';
    instance.pushDisplayState({ runnerStatus: 'error', runnerScriptName: script?.name ?? null });
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

  const mainSessions = projectSessions.filter((s) => !s.isRunner);
  const runnerSessions = projectSessions.filter((s) => s.isRunner);

  // Reconnect main terminals first
  for (const session of mainSessions) {
    let worktreeBranch: string | undefined;
    let mergeTarget: string | undefined;
    if (session.taskId != null) {
      const task = await window.api.task.getByNumber(projectPath, session.taskId);
      worktreeBranch = task?.branch;
      mergeTarget = task?.mergeTarget;
    }

    const [hookStatus, planPath] = await Promise.all([
      window.api.claudeHooks.getStatus(session.ptyId),
      window.api.plan.getForPty(session.ptyId),
    ]);
    const initialStatus: SummaryType = hookStatus?.status === 'thinking' ? 'thinking' : 'ready';

    const term = await reconnectTerminal(session, { worktreeBranch, mergeTarget, initialStatus });
    if (term && planPath) {
      term.planPath = planPath;
      term.pushDisplayState({ planPath });
    }
  }

  // Reconnect runners to their parent terminals
  for (const session of runnerSessions) {
    const parentTerminal = terminalInstances.get(session.parentPtyId!);
    if (!parentTerminal) {
      actionsLog.warn('could not find parent for runner', { ptyId: session.ptyId, parentPtyId: session.parentPtyId });
      continue;
    }

    const runner = new OuijitTerminal({
      projectPath: session.projectPath,
      label: session.label,
      isRunner: true,
      ptyId: session.ptyId,
    });
    runner.openTerminal();

    const result = await window.api.pty.reconnect(session.ptyId);
    if (!result.success) {
      runner.dispose();
      continue;
    }

    runner.replayBuffer(result.bufferedOutput, result.lastCols, result.isAltScreen);
    terminalInstances.set(session.ptyId, runner);
    runner.bind(session.ptyId, {
      skipSideEffects: true,
      onData: (data) => {
        const oscMatches = data.matchAll(/\x1b\]0;([^\x07]*)\x07/g);
        for (const match of oscMatches) {
          if (match[1]) {
            parentTerminal.runnerCommand = match[1];
            parentTerminal.pushDisplayState({ runnerStatus: parentTerminal.runnerStatus });
          }
        }
        const detected = detectDevServerUrl(data);
        if (detected) applyDetectedWebPreviewUrl(parentTerminal, detected);
      },
      onExit: (exitCode) => {
        parentTerminal.runnerStatus = exitCode === 0 ? 'success' : 'error';
        parentTerminal.pushDisplayState({ runnerStatus: parentTerminal.runnerStatus });
      },
    });

    parentTerminal.runnerStatus = 'running';
    parentTerminal.setRunner(runner);
    parentTerminal.pushDisplayState({ runnerStatus: 'running' });
  }
}
