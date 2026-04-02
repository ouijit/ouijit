import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BrowserWindow } from 'electron';
import { typedHandle } from '../helpers';
import { getPlanPath } from '../../hookServer';
import log from '../../log';

const planLog = log.scope('plan');

const PLANS_DIR = path.join(os.homedir(), '.claude', 'plans');

const watchers = new Map<string, { watcher: fs.FSWatcher; timer: ReturnType<typeof setTimeout> | null }>();

export function registerPlanHandlers(mainWindow: BrowserWindow): void {
  typedHandle('plan:read', (planPath) => {
    // Validate path is under ~/.claude/plans/
    if (!planPath.startsWith(PLANS_DIR + path.sep)) return null;
    try {
      return fs.readFileSync(planPath, 'utf-8');
    } catch {
      return null;
    }
  });

  typedHandle('plan:watch', (planPath) => {
    if (!planPath.startsWith(PLANS_DIR + path.sep)) return { success: false };
    if (watchers.has(planPath)) return { success: true };

    try {
      const watcher = fs.watch(planPath, () => {
        // Debounce: fs.watch can fire multiple times per write
        const entry = watchers.get(planPath);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          try {
            const content = fs.readFileSync(planPath, 'utf-8');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('plan:content-changed', planPath, content);
            }
          } catch (err) {
            planLog.warn('failed to read plan file on change', {
              planPath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }, 200);
      });

      watchers.set(planPath, { watcher, timer: null });
      return { success: true };
    } catch (err) {
      planLog.warn('failed to watch plan file', {
        planPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return { success: false };
    }
  });

  typedHandle('plan:unwatch', (planPath) => {
    const entry = watchers.get(planPath);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.watcher.close();
      watchers.delete(planPath);
    }
  });

  typedHandle('plan:get-for-pty', (ptyId) => getPlanPath(ptyId));
}

/** Clean up all file watchers (call on app quit). */
export function cleanupPlanWatchers(): void {
  for (const [, entry] of watchers) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
  }
  watchers.clear();
}
