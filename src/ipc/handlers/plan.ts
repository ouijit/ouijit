import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { typedHandle } from '../helpers';
import { getPlanPath } from '../../hookServer';
import log from '../../log';

const planLog = log.scope('plan');

function isMarkdownFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.md';
}

const watchers = new Map<string, { watcher: fs.FSWatcher; timer: ReturnType<typeof setTimeout> | null }>();

export function registerPlanHandlers(mainWindow: BrowserWindow): void {
  typedHandle('plan:read', async (planPath) => {
    const resolved = path.resolve(planPath);
    if (!isMarkdownFile(resolved)) return null;
    try {
      return await fs.promises.readFile(resolved, 'utf-8');
    } catch {
      return null;
    }
  });

  typedHandle('plan:watch', (planPath) => {
    const resolved = path.resolve(planPath);
    if (!isMarkdownFile(resolved)) return { success: false };
    if (watchers.has(resolved)) return { success: true };

    try {
      const watcher = fs.watch(resolved, () => {
        // Debounce: fs.watch can fire multiple times per write
        const entry = watchers.get(resolved);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(async () => {
          entry.timer = null;
          try {
            const content = await fs.promises.readFile(resolved, 'utf-8');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('plan:content-changed', planPath, content);
            }
          } catch (err) {
            planLog.warn('failed to read plan file on change', {
              planPath: resolved,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }, 200);
      });

      watchers.set(resolved, { watcher, timer: null });
      return { success: true };
    } catch (err) {
      planLog.warn('failed to watch plan file', {
        planPath: resolved,
        error: err instanceof Error ? err.message : String(err),
      });
      return { success: false };
    }
  });

  typedHandle('plan:unwatch', (planPath) => {
    const resolved = path.resolve(planPath);
    const entry = watchers.get(resolved);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.watcher.close();
      watchers.delete(resolved);
    }
  });

  typedHandle('plan:get-for-pty', (ptyId) => getPlanPath(ptyId));

  typedHandle('plan:check-files-exist', async (workspaceRoot, filePaths) => {
    const result: Record<string, boolean> = {};
    await Promise.all(
      filePaths.map(async (fp) => {
        const resolved = path.resolve(workspaceRoot, fp);
        if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
          result[fp] = false;
          return;
        }
        try {
          await fs.promises.access(resolved);
          result[fp] = true;
        } catch {
          result[fp] = false;
        }
      }),
    );
    return result;
  });

  typedHandle('plan:pick-file', async (defaultPath) => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showOpenDialog(targetWindow, {
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: defaultPath ?? undefined,
      title: 'Select Plan File',
      buttonLabel: 'Open Plan',
    });
    return {
      canceled: result.canceled,
      filePath: result.filePaths[0] ?? null,
    };
  });
}

/** Clean up all file watchers (call on app quit). */
export function cleanupPlanWatchers(): void {
  for (const [, entry] of watchers) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
  }
  watchers.clear();
}
