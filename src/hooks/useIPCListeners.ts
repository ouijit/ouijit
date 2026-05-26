import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore, type PendingCliStart } from '../stores/projectStore';
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
        ipcLog.info('CLI task-completed: running completeTask', {
          project: payload.project,
          taskNumber: payload.taskNumber,
        });
        void completeTask({
          projectPath: payload.project,
          task: payload.task,
          skipHook: payload.skipHook,
          hookCommand: payload.hookCommand,
          // Server already PATCHed the status before pushing; only the
          // renderer reload remains.
          skipStatusWrite: true,
        }).catch((err) => {
          ipcLog.error('CLI task-completed lifecycle failed', {
            taskNumber: payload.taskNumber,
            error: err instanceof Error ? err.message : String(err),
          });
        });
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
