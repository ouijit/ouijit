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
  TaskWithWorkspace,
} from '../../types';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useCanvasStore, persistCanvas } from '../../stores/canvasStore';
import { useAppStore, staleGuard } from '../../stores/appStore';
import { OuijitTerminal, terminalInstances, resolveTerminalLabel, type SummaryType } from './terminalReact';
import { parseOsc133ExitCodes } from './osc133';
import { buildEditorCommand } from './editorCommand';
import { readSnapshot } from './sessionSnapshot';
import { detectDevServerUrl } from '../webPreview/urlHelpers';
import { descriptionToHookPrompt } from '../../utils/descriptionAttachments';
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
  existingWorktree?: WorktreeInfo & { prompt?: string; sandboxed?: boolean };
  sandboxed?: boolean;
  taskId?: number;
  skipAutoHook?: boolean;
  background?: boolean;
  /** Overrides the auto-derived card label (e.g. a user-renamed terminal being
   *  restored from a session snapshot). */
  label?: string;
  /** Apply persisted UI state (plan, web preview, runner panel) after spawn — for session restore. */
  initialUiState?: SnapshotTerminalUi;
  /** If set, the new terminal takes this loading slot's place via
   *  `rekeyTerminal` rather than being appended. Lets the kanban-drop loading
   *  card morph into the real terminal in the same stack position. */
  replaceLoadingId?: string;
  /** Close this terminal automatically after a short grace period when its
   *  underlying command exits with code 0 (signalled by OSC 133;D from the
   *  shell-integration precmd hook). On non-zero exit it stays open so the
   *  failure is debuggable in the interactive shell that survives the command. */
  autoCloseOnSuccess?: boolean;
}

// ── Apply persisted UI state from a session snapshot ────────────────

/**
 * Re-apply per-terminal UI state captured in a session snapshot. Shared by
 * the cross-launch restore path (fresh shells) and the renderer-reload
 * reconnect path (live PTYs), so the two stay in lockstep.
 */
export async function applyInitialUiState(term: OuijitTerminal, ui: SnapshotTerminalUi): Promise<void> {
  if (ui.planPath) {
    term.planPath = ui.planPath;
    // Older snapshots had no planPanelOpen flag and always re-opened the panel
    // when a plan was attached — preserve that as the fallback.
    term.planPanelOpen = ui.planPanelOpen ?? true;
    term.pushDisplayState({ planPath: ui.planPath, planPanelOpen: term.planPanelOpen });
  }

  if (ui.diffPanelOpen) {
    term.diffPanelOpen = true;
    term.pushDisplayState({ diffPanelOpen: true });
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
    // would silently fire on Resume. Pre-load the script so one click on Run
    // re-launches it, and surface its name in the header.
    term.runnerFullWidth = ui.runner.fullWidth;
    term.runnerScript = { name: ui.runner.scriptName ?? '', command: ui.runner.scriptCommand };
    term.pushDisplayState({ runnerScriptName: ui.runner.scriptName ?? null });
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

// ── Worktree hook environment ────────────────────────────────────────

/**
 * Build the env vars handed to a worktree-backed terminal's hook.
 *
 * The task description MUST come from `task` — a live DB fetch — and never
 * from the worktree snapshot in `AddProjectTerminalOptions.existingWorktree`.
 * That snapshot is captured when the worktree is created and never refreshed,
 * so sourcing it from there leaves OUIJIT_TASK_DESCRIPTION stale (or absent
 * entirely, since the var is only set when the value is truthy) after a task's
 * description is edited.
 *
 * OUIJIT_TASK_PROMPT is kept as a deprecated alias of OUIJIT_TASK_DESCRIPTION
 * so existing user hooks that reference the old name keep working.
 */
export function buildWorktreeStartEnv(params: {
  hookType: string;
  projectPath: string;
  worktreeInfo: WorktreeInfo;
  label: string;
  task: TaskWithWorkspace | null;
}): Record<string, string> {
  const { hookType, projectPath, worktreeInfo, label, task } = params;
  const env: Record<string, string> = {
    OUIJIT_HOOK_TYPE: hookType,
    OUIJIT_PROJECT_PATH: projectPath,
    OUIJIT_WORKTREE_PATH: worktreeInfo.path,
    OUIJIT_TASK_BRANCH: worktreeInfo.branch,
    OUIJIT_TASK_NAME: label,
  };
  const description = task?.prompt;
  if (description) {
    const descriptionForHook = descriptionToHookPrompt(description);
    env.OUIJIT_TASK_DESCRIPTION = descriptionForHook;
    env.OUIJIT_TASK_PROMPT = descriptionForHook;
  }
  return env;
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
  const worktreeInfo: (WorktreeInfo & { prompt?: string }) | undefined = options?.existingWorktree;

  if (worktreeInfo) {
    terminalCwd = worktreeInfo.path;
  }

  // Look up the current task. Name, merge target AND prompt all come from this
  // live fetch — the worktree snapshot's prompt is a stale copy from worktree
  // creation time and would not reflect a description edited afterwards.
  let task: TaskWithWorkspace | null = null;
  if (options?.taskId != null) {
    task = await window.api.task.getByNumber(projectPath, options.taskId);
  }
  const taskName = task?.name;
  const mergeTarget = task?.mergeTarget;
  const taskPrompt = task?.prompt;

  if (isStale()) return false;

  const label = options?.label ?? resolveTerminalLabel(taskName, worktreeInfo?.branch, runConfig?.name);
  const command = runConfig?.command;

  // Determine command to run
  let startCommand = command;
  let startEnv: Record<string, string> | undefined;

  if (worktreeInfo) {
    startEnv = buildWorktreeStartEnv({
      hookType: 'continue',
      projectPath,
      worktreeInfo,
      label,
      task,
    });

    if (!runConfig && !options?.skipAutoHook) {
      const hooks = await window.api.hooks.get(projectPath);
      if (hooks.continue) {
        startCommand = hooks.continue.command;
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
    autoCloseOnSuccess: options?.autoCloseOnSuccess,
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

// ── Rename a terminal ────────────────────────────────────────────────

/**
 * Apply a user rename. Writes through to (1) the display state the card reads
 * from, (2) the OuijitTerminal instance — which `gatherSnapshot` persists, so
 * the rename survives a cross-launch restore — and (3) the main-process PTY
 * record, so a renderer-reload reconnect comes back with the renamed label
 * rather than the original. Empty/whitespace names are ignored.
 */
export function renameTerminal(ptyId: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  const instance = terminalInstances.get(ptyId);
  if (instance) instance.label = trimmed;
  useTerminalStore.getState().updateDisplay(ptyId, { label: trimmed });
  window.api.pty.setLabel(ptyId, trimmed);
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
  opts: { worktreeBranch?: string; mergeTarget?: string; initialStatus?: SummaryType; label?: string } = {},
): Promise<OuijitTerminal | null> {
  const label = opts.label ?? session.label;
  const term = new OuijitTerminal({
    ptyId: session.ptyId,
    projectPath: session.projectPath,
    command: session.command,
    label,
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

  // Register in store as a background terminal — focus is restored explicitly
  // by reconnectOrphanedSessions once every PTY for the project is back, so the
  // last-reconnected one doesn't steal it.
  registerTerminal(
    term,
    session.projectPath,
    {
      label,
      sandboxed: !!session.sandboxed,
      taskId: session.taskId ?? null,
      worktreeBranch: opts.worktreeBranch ?? null,
      summaryType: opts.initialStatus ?? 'ready',
    },
    /* background */ true,
  );

  // Load tags and git status
  term.loadTags();
  term.refreshGitStatus();

  return term;
}

// ── Run hook or ad-hoc script as runner terminal ────────────────────

/**
 * Drive the parent terminal's runnerStatus from OSC 133;D sequences emitted by
 * the runner's shell-integration precmd hook. The PTY's onExit fires only when
 * the *shell* exits (i.e. when the user types `exit`), which is essentially
 * never for a long-running runner — OSC 133 is the per-command signal that
 * actually reflects whether the script succeeded or failed.
 */
export function updateRunnerStatusFromOsc133(data: string, parent: OuijitTerminal): void {
  // Only the most recent exit code in this batch matters — earlier codes are
  // already visually obsolete by the time the renderer sees them.
  const codes = parseOsc133ExitCodes(data);
  if (codes.length === 0) return;
  const next = codes[codes.length - 1] === 0 ? 'success' : 'error';
  if (parent.runnerStatus !== next) {
    parent.runnerStatus = next;
    parent.pushDisplayState({ runnerStatus: next });
  }
}

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
      ...(instance.taskPrompt && {
        OUIJIT_TASK_DESCRIPTION: descriptionToHookPrompt(instance.taskPrompt),
        // Deprecated alias for OUIJIT_TASK_DESCRIPTION.
        OUIJIT_TASK_PROMPT: descriptionToHookPrompt(instance.taskPrompt),
      }),
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
        updateRunnerStatusFromOsc133(data, instance);
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

// ── Open the worktree in the configured editor ──────────────────────

/**
 * Open a task's worktree in the configured editor.
 *
 * Spawns a new task terminal whose startup command is the editor, so the editor
 * runs in the card's main shell with a real TTY. That TTY is what terminal
 * editors — Helix, Vim, Neovim — need to render; a detached background spawn
 * (`stdio: 'ignore'`) never gives them one, which is why "Open in Editor" did
 * nothing for them on Linux. GUI editors (VS Code, etc.) work too: their
 * launcher returns immediately and the card drops into an interactive shell in
 * the worktree. Returns false when no editor hook is configured so the caller
 * can open the editor config dialog.
 */
export async function openWorktreeEditor(
  projectPath: string,
  worktree: WorktreeInfo,
  taskId: number | undefined,
): Promise<boolean> {
  const hooks = await window.api.hooks.get(projectPath);
  const editor = hooks.editor;
  if (!editor?.command) return false;

  await addProjectTerminal(
    projectPath,
    { name: 'Editor', command: buildEditorCommand(editor.command, worktree.path), source: 'custom', priority: 0 },
    // A terminal editor only signals success once you quit it; a GUI editor's
    // launcher returns immediately. Either way the card tidies itself; a failed
    // launch exits non-zero and stays open.
    { existingWorktree: worktree, taskId, autoCloseOnSuccess: true },
  );
  // Surface the editor terminal: when launched from the kanban, dismiss the
  // board so the new card is visible (mirrors "Open in Terminal").
  useProjectStore.getState().setKanbanVisible(false);
  return true;
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

  // The session snapshot from the same launch (PTYs survive a renderer reload)
  // carries per-terminal UI state and which card was focused. Match its rows to
  // live sessions by ptyId.
  const snapshot = await readSnapshot();
  const snapByPtyId = new Map(
    (snapshot?.terminals ?? [])
      .filter((t) => t.projectPath === projectPath && t.ptyId)
      .map((t) => [t.ptyId as string, t] as const),
  );

  const mainSessions = projectSessions.filter((s) => !s.isRunner);
  const runnerSessions = projectSessions.filter((s) => s.isRunner);

  // Reconnect main terminals first. Skip any session already reconnected — the
  // home view runs the same reconnect as the user lands, so on a refresh both
  // paths can fire for one project; without this guard the shared session would
  // be added to the stack twice.
  for (const session of mainSessions) {
    if (terminalInstances.has(session.ptyId)) continue;
    let worktreeBranch: string | undefined;
    let mergeTarget: string | undefined;
    if (session.taskId != null) {
      const task = await window.api.task.getByNumber(projectPath, session.taskId);
      worktreeBranch = task?.branch;
      mergeTarget = task?.mergeTarget;
    }

    const [hookStatus, planPath] = await Promise.all([
      window.api.agentHooks.getStatus(session.ptyId),
      window.api.plan.getForPty(session.ptyId),
    ]);
    const initialStatus: SummaryType = hookStatus?.status === 'thinking' ? 'thinking' : 'ready';

    const snapEntry = snapByPtyId.get(session.ptyId);
    const term = await reconnectTerminal(session, {
      worktreeBranch,
      mergeTarget,
      initialStatus,
      label: snapEntry?.label ?? undefined,
    });
    if (term) {
      if (snapEntry) await applyInitialUiState(term, snapEntry.ui);
      // The plan association lives in the main process — authoritative for the
      // path; the snapshot only contributes whether the panel was open.
      if (planPath) {
        term.planPath = planPath;
        term.pushDisplayState({ planPath });
      }
    }
  }

  // Restore the focused card. Without this, every reconnectTerminal would have
  // run activateLast and the last PTY back would win the selection.
  {
    const store = useTerminalStore.getState();
    const activeEntry = (snapshot?.terminals ?? []).find(
      (t) => t.projectPath === projectPath && t.isActiveInProject && t.ptyId,
    );
    const idx = activeEntry ? (store.terminalsByProject[projectPath] ?? []).indexOf(activeEntry.ptyId as string) : -1;
    if (idx >= 0) {
      store.setActiveIndex(projectPath, idx);
    } else {
      store.activateLast(projectPath);
    }
  }

  // Reconnect runners to their parent terminals
  for (const session of runnerSessions) {
    if (terminalInstances.has(session.ptyId)) continue;
    await reconnectRunnerToParent(session);
  }
}

/**
 * Reattach a runner (run hook / script) session to its parent terminal after a
 * renderer reload. The runner is NOT a standalone card — it lives as state on
 * the parent (runnerStatus, the runner panel). The parent must already be back
 * in `terminalInstances`, so callers reconnect main terminals first.
 *
 * Returns false if the parent could not be found (caller should leave the
 * session orphaned rather than promote it to a standalone card).
 */
export async function reconnectRunnerToParent(session: ActiveSession): Promise<boolean> {
  const parentTerminal = session.parentPtyId ? terminalInstances.get(session.parentPtyId) : undefined;
  if (!parentTerminal) {
    actionsLog.warn('could not find parent for runner', { ptyId: session.ptyId, parentPtyId: session.parentPtyId });
    return false;
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
    return false;
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
      updateRunnerStatusFromOsc133(data, parentTerminal);
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
  return true;
}
