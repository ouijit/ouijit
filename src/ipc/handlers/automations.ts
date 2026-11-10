import { BrowserWindow, Notification, powerMonitor } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import {
  automationsSnapshot,
  createAutomation,
  deleteAutomation,
  dismissRun,
  makeTaskFromRun,
  openRun,
  runAutomationNow,
  setAutomationPaused,
  startAutomations,
  stopAutomations,
  tick,
  updateAutomation,
} from '../../automations/service';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The window open now: on macOS the app outlives its windows, and automations keep running. */
function currentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}

export function registerAutomationHandlers(): void {
  typedHandle('automations:snapshot', (projectPath) => automationsSnapshot(projectPath));
  typedHandle('automations:save', (projectPath, input, id) => {
    try {
      const automation = id ? updateAutomation(id, input) : createAutomation(projectPath, input);
      return { success: true, automation };
    } catch (error) {
      return { success: false, error: message(error) };
    }
  });
  typedHandle('automations:delete', (id) => deleteAutomation(id));
  typedHandle('automations:set-paused', (id, paused) => {
    setAutomationPaused(id, paused);
  });
  typedHandle('automations:run-now', (id) => runAutomationNow(id));
  typedHandle('automations:open-run', (runId) => openRun(runId));
  typedHandle('automations:dismiss-run', (runId) => dismissRun(runId));
  typedHandle('automations:make-task', async (runId) => {
    try {
      return { success: true, taskNumber: await makeTaskFromRun(runId) };
    } catch (error) {
      return { success: false, error: message(error) };
    }
  });

  startAutomations({
    changed: (projectPath) => {
      const window = currentWindow();
      if (window) typedPush(window, 'automations:changed', projectPath);
    },
    notify: (title, body, projectPath) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body });
      notification.on('click', () => {
        const window = currentWindow();
        if (!window) return;
        window.show();
        window.focus();
        typedPush(window, 'automations:show', projectPath);
      });
      notification.show();
    },
  });
  powerMonitor.on('resume', () => void tick());
}

export function cleanupAutomations(): void {
  stopAutomations();
}
