import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  useProjectStore,
  type PendingCliStart,
  type PendingCliTransition,
  type PendingCliCompletion,
} from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';
import { beginTransition } from '../services/taskStartService';
import { completeTask } from '../services/taskCompletion';
import log from 'electron-log/renderer';

const ipcLog = log.scope('ipcListeners');

async function spawnTerminalForCliStart(projectPath: string, start: PendingCliStart): Promise<void> {
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
    hookControl: start.hookMode ? { mode: start.hookMode, command: start.hookCommand } : undefined,
  });
}

/**
 * Run a CLI-initiated in_progress/in_review transition through the same
 * beginTransition path a kanban drop uses. The server already wrote the status
 * and fetched the full task, so this just fires the hook: a dialog by default,
 * or headless when the CLI passed --run-hook/--skip-hook/--hook-command.
 */
function runCliTransition(projectPath: string, transition: PendingCliTransition): void {
  beginTransition(projectPath, {
    origStatus: transition.origStatus,
    newStatus: transition.newStatus,
    task: transition.task,
    hookControl: transition.hookMode ? { mode: transition.hookMode, command: transition.hookCommand } : undefined,
  });
}

/**
 * Run a CLI-initiated done transition through completeTask. The server already
 * wrote the status (skipStatusWrite), so this drives the done lifecycle:
 * terminal cleanup always runs; the hook is a dialog by default, or headless
 * when the CLI passed --run-hook/--skip-hook/--hook-command.
 */
function runCliCompletion(projectPath: string, completion: PendingCliCompletion): void {
  void completeTask({
    projectPath,
    task: completion.task,
    hookControl: completion.hookMode ? { mode: completion.hookMode, command: completion.hookCommand } : undefined,
    skipStatusWrite: true,
  }).catch((err) => {
    ipcLog.error('CLI task-completed lifecycle failed', {
      taskNumber: completion.taskNumber,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Registers global IPC push event listeners.
 * Call once in App.tsx. Handles cleanup on unmount.
 *
 * Per-terminal listeners (pty:data, pty:exit) remain in OuijitTerminal.bind()
 * and are NOT registered here — they are imperative, not React-managed.
 *
 * Agent hook status listener lives in useHookStatusListener() so both the
 * home and project views can mount it independently without pulling the
 * terminal module in at top level here.
 */
export function useIPCListeners() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    // Fullscreen state changes from main process
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

    // Health probe results from main
    cleanups.push(
      window.api.health.onUpdate((status) => {
        useAppStore.getState().setHealth(status);
      }),
    );

    // CLI changes — re-fetch tasks when CLI writes to the sentinel file
    cleanups.push(
      window.api.onCliChange((payload) => {
        const activeProject = useAppStore.getState().activeProjectPath;
        if (activeProject && payload.project === activeProject) {
          ipcLog.info('CLI change detected, refreshing tasks', { action: payload.action });
          useProjectStore.getState().loadTasks(activeProject);
          if (payload.message) {
            useProjectStore.getState().addToast(payload.message, 'info');
          }
        }
      }),
    );

    // CLI-initiated done transition — server already wrote status and included
    // the full task in the payload, so the done-hook lifecycle (snapshot
    // terminals, spawn done hook, close snapshot) can run regardless of which
    // project the user is currently viewing. completeTask itself guards
    // loadTasks against clobbering the active project's task list, so the
    // visible kanban catches up on next navigation.
    cleanups.push(
      window.api.onCliTaskCompleted((payload) => {
        const activeProject = useAppStore.getState().activeProjectPath;
        const completion: PendingCliCompletion = {
          taskNumber: payload.taskNumber,
          task: payload.task,
          hookMode: payload.hookMode,
          hookCommand: payload.hookCommand,
        };

        // A bare done (no hookMode) shows the Done dialog, which can only render
        // for the project the user is viewing — queue it otherwise and drain on
        // navigation. A done with explicit hook flags is headless (no dialog),
        // so it runs immediately regardless of which project is in view.
        if (payload.hookMode || activeProject === payload.project) {
          ipcLog.info('CLI task-completed: running completeTask', {
            project: payload.project,
            taskNumber: payload.taskNumber,
          });
          runCliCompletion(payload.project, completion);
        } else {
          ipcLog.info('CLI task-completed: queuing for later navigation', {
            project: payload.project,
            taskNumber: payload.taskNumber,
          });
          useProjectStore.getState().enqueueCliCompletion(payload.project, completion);
        }
      }),
    );

    // CLI-initiated task start — spawn a terminal + run the configured hook.
    // If the user isn't viewing the project, queue it and drain on navigation.
    cleanups.push(
      window.api.onCliTaskStarted((payload) => {
        const activeProject = useAppStore.getState().activeProjectPath;
        const start: PendingCliStart = {
          taskNumber: payload.taskNumber,
          worktreePath: payload.worktreePath,
          branch: payload.branch,
          createdAt: payload.createdAt,
          sandboxed: payload.sandboxed,
          hookMode: payload.hookMode,
          hookCommand: payload.hookCommand,
        };

        if (activeProject === payload.project) {
          ipcLog.info('CLI task-started: spawning terminal', { taskNumber: payload.taskNumber });
          void spawnTerminalForCliStart(payload.project, start).catch((err) => {
            ipcLog.error('CLI task-started spawn failed', {
              taskNumber: payload.taskNumber,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        } else {
          ipcLog.info('CLI task-started: queuing for later navigation', {
            project: payload.project,
            taskNumber: payload.taskNumber,
          });
          useProjectStore.getState().enqueueCliStart(payload.project, start);
        }
      }),
    );

    // CLI-initiated in_progress/in_review transition — fire the column hook via
    // beginTransition. A bare transition (no hookMode) shows that column's hook
    // dialog, which can only render for the project the user is viewing — queue
    // it otherwise and drain on navigation. A transition with explicit hook
    // flags is headless (no dialog), so it runs immediately regardless of which
    // project is in view, the same as a headless done.
    cleanups.push(
      window.api.onCliTaskTransitioned((payload) => {
        const activeProject = useAppStore.getState().activeProjectPath;
        const transition: PendingCliTransition = {
          taskNumber: payload.taskNumber,
          origStatus: payload.origStatus,
          newStatus: payload.newStatus,
          task: payload.task,
          hookMode: payload.hookMode,
          hookCommand: payload.hookCommand,
        };

        if (payload.hookMode || activeProject === payload.project) {
          ipcLog.info('CLI task-transitioned: running transition', {
            taskNumber: payload.taskNumber,
            newStatus: payload.newStatus,
          });
          runCliTransition(payload.project, transition);
        } else {
          ipcLog.info('CLI task-transitioned: queuing for later navigation', {
            project: payload.project,
            taskNumber: payload.taskNumber,
          });
          useProjectStore.getState().enqueueCliTransition(payload.project, transition);
        }
      }),
    );

    // Drain queued CLI starts whenever the active project changes.
    const drain = (projectPath: string | null) => {
      if (!projectPath) return;
      const queued = useProjectStore.getState().drainCliStarts(projectPath);
      for (const start of queued) {
        ipcLog.info('draining queued CLI task-started', {
          project: projectPath,
          taskNumber: start.taskNumber,
        });
        void spawnTerminalForCliStart(projectPath, start).catch((err) => {
          ipcLog.error('queued CLI task-started spawn failed', {
            taskNumber: start.taskNumber,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      const queuedTransitions = useProjectStore.getState().drainCliTransitions(projectPath);
      for (const transition of queuedTransitions) {
        ipcLog.info('draining queued CLI task-transitioned', {
          project: projectPath,
          taskNumber: transition.taskNumber,
        });
        runCliTransition(projectPath, transition);
      }
      const queuedCompletions = useProjectStore.getState().drainCliCompletions(projectPath);
      for (const completion of queuedCompletions) {
        ipcLog.info('draining queued CLI task-completed', {
          project: projectPath,
          taskNumber: completion.taskNumber,
        });
        runCliCompletion(projectPath, completion);
      }
    };
    // Initial drain in case events arrived before this effect mounted.
    drain(useAppStore.getState().activeProjectPath);
    const unsubscribeAppStore = useAppStore.subscribe((state, prev) => {
      if (state.activeProjectPath !== prev.activeProjectPath) {
        drain(state.activeProjectPath);
      }
    });
    cleanups.push(unsubscribeAppStore);

    // Sandbox branch diverged — agent commits can't fast-forward onto the
    // user's task branch because the user committed in parallel. Surface a
    // persistent toast so the user can reconcile manually in their IDE.
    cleanups.push(
      window.api.lima.onSandboxDiverged((event) => {
        ipcLog.warn('sandbox branch diverged from user branch', event);
        useProjectStore
          .getState()
          .addToast(`Task T-${event.taskNumber}: agent commits diverged from your branch. Merge manually to sync.`, {
            type: 'error',
            persistent: true,
          });
      }),
    );

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
}
