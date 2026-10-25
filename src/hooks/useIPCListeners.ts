import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  SANDBOX_LABELS,
  type CliCaller,
  type CliHookControl,
  type HookType,
  type TaskStatus,
  type TaskWithWorkspace,
} from '../types';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';
import { projectDefaultSandbox, refreshProjectData } from '../stores/projectDataStore';
import { isActiveSandbox } from '../sandbox/types';
import { beginTransition } from '../services/taskStartService';
import { hookSandbox, hookTypeForTransition } from '../services/hookRun';
import { usePointerStore } from '../stores/pointerStore';
import { completeTask } from '../services/taskCompletion';
import { reloadTheme } from '../theme/themeManager';
import log from 'electron-log/renderer';

const ipcLog = log.scope('ipcListeners');

interface CliStart extends CliHookControl, CliCaller {
  taskNumber: number;
  worktreePath: string;
  branch: string;
}

function hookOptions({ hookMode, hookCommand, hookSandbox }: CliHookControl) {
  return { hookControl: hookMode ? { mode: hookMode, command: hookCommand } : undefined, sandbox: hookSandbox };
}

/**
 * A CLI task move never takes over the screen. Where its hook would open a
 * dialog, the move waits behind a pointer at the task, from the terminal that
 * ran it, and the dialog opens when the user follows. Otherwise it runs at
 * once, its terminal behind the one on screen.
 *
 * A sandboxed caller's `--run-hook` waits for the dialog too when the hook
 * runs on the host, since it would run there in a worktree the caller wrote.
 */
async function stageOrRun(
  projectPath: string,
  task: TaskWithWorkspace,
  move: CliHookControl & CliCaller & { hookType: HookType | null },
  run: (background: boolean, control: CliHookControl) => void,
): Promise<void> {
  const { fromPtyId } = move;
  const target = { kind: 'task' as const, projectPath, taskNumber: task.taskNumber };
  const hook = move.hookType != null ? (await window.api.hooks.get(projectPath))[move.hookType] : undefined;
  const onHostUnseen =
    !!hook &&
    !!move.fromSandbox &&
    move.hookMode === 'run' &&
    !isActiveSandbox(hookSandbox(undefined, hook, await projectDefaultSandbox(projectPath)));
  if (hook && (!move.hookMode || onHostUnseen) && fromPtyId) {
    usePointerStore.getState().point({ from: fromPtyId, target, move: () => run(false, {}) });
    return;
  }
  run(true, move);
  if (move.point && fromPtyId) usePointerStore.getState().point({ from: fromPtyId, target });
}

async function spawnTerminalForCliStart(projectPath: string, start: CliStart): Promise<void> {
  // Guard against double-spawn: skip if a terminal for this task already exists.
  const terminals = useTerminalStore.getState().terminalsByProject[projectPath] ?? [];
  const displayStates = useTerminalStore.getState().displayStates;
  if (terminals.some((ptyId) => displayStates[ptyId]?.taskId === start.taskNumber)) {
    ipcLog.info('skipping CLI task-started spawn — terminal already exists', {
      project: projectPath,
      taskNumber: start.taskNumber,
    });
    return;
  }

  // Use the full task record so beginTransition has name/mergeTarget/etc.
  // The CLI already created the worktree and flipped status, so the
  // transition's worktree-creation step short-circuits on task.worktreePath.
  const found = await window.api.task.getByNumber(projectPath, start.taskNumber);
  if (!found) {
    ipcLog.warn('CLI task-started: task not found, skipping spawn', { taskNumber: start.taskNumber });
    return;
  }
  const task = {
    ...found,
    worktreePath: found.worktreePath ?? start.worktreePath,
    branch: found.branch ?? start.branch,
  };

  // The same service a kanban drag to In progress goes through.
  await stageOrRun(projectPath, task, { ...start, hookType: 'start' }, (background, control) =>
    beginTransition(projectPath, {
      origStatus: 'todo',
      newStatus: 'in_progress',
      task,
      ...hookOptions(control),
      background,
    }),
  );
}

/**
 * Run a CLI-initiated in_progress/in_review transition through the same
 * beginTransition path a kanban drop uses. The server already wrote the status
 * and fetched the full task, so this just fires the hook.
 */
async function runCliTransition(
  projectPath: string,
  transition: CliHookControl & CliCaller & { origStatus: TaskStatus; newStatus: TaskStatus; task: TaskWithWorkspace },
): Promise<void> {
  const { origStatus, newStatus, task } = transition;
  await stageOrRun(
    projectPath,
    task,
    { ...transition, hookType: hookTypeForTransition(origStatus, newStatus) },
    (background, control) =>
      beginTransition(projectPath, { origStatus, newStatus, task, ...hookOptions(control), background }),
  );
}

/**
 * Run a CLI-initiated done transition through completeTask. The server already
 * wrote the status (skipStatusWrite), so this drives the done lifecycle:
 * terminal cleanup and the done hook.
 */
async function runCliCompletion(
  projectPath: string,
  completion: CliHookControl & CliCaller & { task: TaskWithWorkspace },
): Promise<void> {
  await stageOrRun(projectPath, completion.task, { ...completion, hookType: 'done' }, (_background, control) => {
    void completeTask({
      projectPath,
      task: completion.task,
      ...hookOptions(control),
      skipStatusWrite: true,
    }).catch((err) => {
      ipcLog.error('CLI task-completed lifecycle failed', {
        taskNumber: completion.task.taskNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

/**
 * Registers global IPC push event listeners.
 * Call once; cleans up on unmount.
 *
 * Per-terminal listeners (pty:data, pty:exit) remain in OuijitTerminal.bind()
 * and are NOT registered here — they are imperative, not React-managed.
 */
export function useIPCListeners() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    cleanups.push(
      window.api.onFullscreenChange((isFullscreen) => {
        useAppStore.getState().setFullscreen(isFullscreen);
      }),
    );

    // App update available (Linux — macOS uses native Squirrel dialog)
    cleanups.push(
      window.api.onUpdateAvailable((info) => {
        useProjectStore.getState().addToast(`Version ${info.version} is available`, {
          type: 'info',
          persistent: true,
          actionLabel: 'Download',
          onAction: () => window.api.openExternal(info.url),
        });
      }),
    );

    cleanups.push(
      window.api.onSandboxLaunchFailed(({ provider, exitCode, error }) => {
        const reason = error ? `: ${error}` : ` (exit ${exitCode}). See the terminal output.`;
        useProjectStore.getState().addToast(`${SANDBOX_LABELS[provider]} failed to start${reason}`, {
          type: 'error',
          persistent: true,
        });
      }),
    );

    cleanups.push(
      window.api.onTerminalSandbox(({ ptyId, sandboxProvider }) => {
        useTerminalStore.getState().updateDisplay(ptyId, { sandboxProvider });
      }),
    );

    // Spawned a shell with no integration provider (not zsh/bash/fish). It
    // launches fine, but the wrapper-PATH fix and command status dots may not
    // work. Notify once per shell, with a one-click path to request support.
    cleanups.push(
      window.api.onShellUnsupported(({ shell }) => {
        const name = shell.split('/').pop() || shell;
        const title = `Shell support: ${name}`;
        const body = `Requesting full Ouijit shell integration for \`${name}\`.\n\nShell path: ${shell}\n`;
        const issueUrl = `https://github.com/ouijit/ouijit/issues/new?labels=shell-support&title=${encodeURIComponent(
          title,
        )}&body=${encodeURIComponent(body)}`;
        useProjectStore
          .getState()
          .addToast(
            `${name} isn't a fully supported shell yet. Tasks still run, but the bundled claude and ouijit commands and command status indicators may not work.`,
            {
              type: 'info',
              persistent: true,
              actionLabel: 'Open GitHub issue',
              onAction: () => window.api.openExternal(issueUrl),
            },
          );
      }),
    );

    // "What's New" on first launch after update
    cleanups.push(
      window.api.onWhatsNew((info) => {
        useAppStore.getState().setWhatsNew(info);
      }),
    );

    cleanups.push(
      window.api.onShowAbout(({ version }) => {
        useAppStore.getState().setAboutVersion(version);
      }),
    );

    cleanups.push(
      window.api.health.onUpdate((status) => {
        useAppStore.getState().setHealth(status);
      }),
    );

    cleanups.push(
      window.api.onCliChange((payload) => {
        ipcLog.info('CLI change detected, refreshing', { action: payload.action, project: payload.project });
        refreshProjectData(payload.project, payload.resource);
        if (payload.message) useProjectStore.getState().addToast(payload.message, 'info');
      }),
    );

    // CLI theme mutation — the main process wrote global settings directly,
    // so re-read and re-apply the theme.
    cleanups.push(
      window.api.onCliThemeChanged(() => {
        ipcLog.info('CLI theme change detected, reloading theme');
        void reloadTheme();
      }),
    );

    // The CLI has already written the status. Each of these runs its hook here
    // wherever the user is: headless when the CLI passed a hook flag, otherwise
    // through the hook dialog.
    cleanups.push(
      window.api.onCliTaskCompleted((payload) => {
        ipcLog.info('CLI task-completed', { project: payload.project, taskNumber: payload.taskNumber });
        void runCliCompletion(payload.project, payload);
      }),
    );

    cleanups.push(
      window.api.onCliTaskStarted((payload) => {
        ipcLog.info('CLI task-started', { project: payload.project, taskNumber: payload.taskNumber });
        void spawnTerminalForCliStart(payload.project, payload).catch((err) => {
          ipcLog.error('CLI task-started spawn failed', {
            taskNumber: payload.taskNumber,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }),
    );

    cleanups.push(
      window.api.onCliTaskTransitioned((payload) => {
        ipcLog.info('CLI task-transitioned', { taskNumber: payload.taskNumber, newStatus: payload.newStatus });
        void runCliTransition(payload.project, payload);
      }),
    );

    // Clone progress arrives as pushes; the list is fetched once so a reload
    // mid-clone still shows what is in flight.
    void window.api.listClones().then((jobs) => useAppStore.getState().setCloneJobs(jobs));
    cleanups.push(window.api.onClonesChanged((jobs) => useAppStore.getState().setCloneJobs(jobs)));
    cleanups.push(
      window.api.onCloneLanded(async () => {
        useAppStore.getState().setProjects(await window.api.refreshProjects());
      }),
    );

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
}
