import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import log from 'electron-log/renderer';

const ipcLog = log.scope('ipcListeners');

/**
 * Registers global IPC push event listeners.
 * Call once in App.tsx. Handles cleanup on unmount.
 *
 * Per-terminal listeners (pty:data, pty:exit) remain in OuijitTerminal.bind()
 * and are NOT registered here — they are imperative, not React-managed.
 *
 * Claude hook status listener is registered in useHookStatusListener()
 * to avoid pulling in terminal module at top-level.
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

    // Sandbox .git tampering — agent wrote to .git/hooks or .git/config.
    // Could be benign (agent setting user.email) or an escape attempt
    // (core.hooksPath redirect, pre-commit injection). Show the user what
    // changed and let them decide.
    cleanups.push(
      window.api.lima.onSandboxGitTampering((event) => {
        ipcLog.warn('sandbox git tampering detected', event);
        const parts: string[] = [];
        if (event.delta.hooks) {
          const { added, modified, removed } = event.delta.hooks;
          const counts = [
            added.length && `${added.length} hook${added.length === 1 ? '' : 's'} added`,
            modified.length && `${modified.length} modified`,
            removed.length && `${removed.length} removed`,
          ].filter(Boolean);
          if (counts.length) parts.push(counts.join(', '));
        }
        if (event.delta.config) {
          const n = event.delta.config.addedLines.length + event.delta.config.removedLines.length;
          parts.push(`${n} config line${n === 1 ? '' : 's'} changed`);
        }
        const summary = parts.length ? parts.join('; ') : 'unknown change';
        useProjectStore
          .getState()
          .addToast(
            `Task T-${event.taskNumber}: sandbox modified .git (${summary}). Review before running git on this repo.`,
            {
              type: 'error',
              persistent: true,
            },
          );
      }),
    );

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
}
