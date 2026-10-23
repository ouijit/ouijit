import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { SANDBOX_LABELS, type CliHookControl, type TaskStatus, type TaskWithWorkspace } from '../types';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';
import { refreshProjectData } from '../stores/projectDataStore';
import { beginTransition } from '../services/taskStartService';
import { completeTask } from '../services/taskCompletion';
import { reloadTheme } from '../theme/themeManager';
import log from 'electron-log/renderer';

const ipcLog = log.scope('ipcListeners');

interface CliStart extends CliHookControl {
  taskNumber: number;
  worktreePath: string;
  branch: string;
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
  const task = await window.api.task.getByNumber(projectPath, start.taskNumber);
  if (!task) {
    ipcLog.warn('CLI task-started: task not found, skipping spawn', { taskNumber: start.taskNumber });
    return;
  }

  // Route through the same service the kanban drag uses. With no hook flags
  // the `start` hook dialog appears, matching the todo → in_progress drop UX
  // exactly. When the CLI passed --run-hook/--skip-hook/--hook-command, the
  // dialog is skipped so an agent can start a task headlessly.
  beginTransition(projectPath, {
    origStatus: 'todo',
    newStatus: 'in_progress',
    task: {
      ...task,
      worktreePath: task.worktreePath ?? start.worktreePath,
      branch: task.branch ?? start.branch,
    },
    ...hookOptions(start),
    background: true,
  });
}

function hookOptions({ hookMode, hookCommand, hookSandbox }: CliHookControl) {
  return { hookControl: hookMode ? { mode: hookMode, command: hookCommand } : undefined, sandbox: hookSandbox };
}

/**
 * Run a CLI-initiated in_progress/in_review transition through the same
 * beginTransition path a kanban drop uses. The server already wrote the status
 * and fetched the full task, so this just fires the hook: a dialog by default,
 * or headless when the CLI passed --run-hook/--skip-hook/--hook-command.
 */
function runCliTransition(
  projectPath: string,
  transition: CliHookControl & { origStatus: TaskStatus; newStatus: TaskStatus; task: TaskWithWorkspace },
): void {
  beginTransition(projectPath, {
    origStatus: transition.origStatus,
    newStatus: transition.newStatus,
    task: transition.task,
    ...hookOptions(transition),
    background: true,
  });
}

/**
 * Run a CLI-initiated done transition through completeTask. The server already
 * wrote the status (skipStatusWrite), so this drives the done lifecycle:
 * terminal cleanup always runs; the hook is a dialog by default, or headless
 * when the CLI passed --run-hook/--skip-hook/--hook-command.
 */
function runCliCompletion(projectPath: string, completion: CliHookControl & { task: TaskWithWorkspace }): void {
  void completeTask({
    projectPath,
    task: completion.task,
    ...hookOptions(completion),
    skipStatusWrite: true,
  }).catch((err) => {
    ipcLog.error('CLI task-completed lifecycle failed', {
      taskNumber: completion.task.taskNumber,
      error: err instanceof Error ? err.message : String(err),
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
        runCliCompletion(payload.project, payload);
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
        runCliTransition(payload.project, payload);
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
