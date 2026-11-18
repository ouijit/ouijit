import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { typedHandle } from '../helpers';
import { getLogger } from '../../logger';
import { resolveWithinBase, isSymlinkEscapeError } from '../../utils/pathSafety';
import { readMarkdownImage } from '../../markdownImages';
import { watchFileContents } from '../../fileWatch';

const planLog = getLogger().scope('plan');

function isMarkdownFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.md';
}

const watchers = new Map<string, () => void>();

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

  typedHandle('plan:read-image', async (planPath, src) => {
    const resolved = path.resolve(planPath);
    if (!isMarkdownFile(resolved)) return null;
    return readMarkdownImage(resolved, src);
  });

  typedHandle('plan:watch', (planPath) => {
    const resolved = path.resolve(planPath);
    if (!isMarkdownFile(resolved)) return { success: false };
    if (watchers.has(resolved)) return { success: true };

    try {
      const stop = watchFileContents(
        resolved,
        (content) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('plan:content-changed', planPath, content);
          }
        },
        (err) =>
          planLog.warn('failed to read plan file on change', {
            planPath: resolved,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
      watchers.set(resolved, stop);
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
    watchers.get(resolved)?.();
    watchers.delete(resolved);
  });

  typedHandle('plan:check-files-exist', async (workspaceRoot, filePaths) => {
    const result: Record<string, boolean> = {};
    await Promise.all(
      filePaths.map(async (fp) => {
        try {
          // resolveWithinBase follows symlinks through to the real path
          // and rejects anything that escapes the worktree — prevents
          // a guest-planted symlink from leaking the existence of host
          // files outside the worktree boundary.
          const resolved = await resolveWithinBase(workspaceRoot, fp);
          await fs.promises.access(resolved);
          result[fp] = true;
        } catch (err) {
          if (isSymlinkEscapeError(err)) {
            planLog.warn('file check rejected symlink escape', {
              workspaceRoot,
              file: fp,
              resolved: err.resolved,
            });
          }
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
      title: 'Select Markdown File',
      buttonLabel: 'Open',
    });
    return {
      canceled: result.canceled,
      filePath: result.filePaths[0] ?? null,
    };
  });
}

export function cleanupPlanWatchers(): void {
  for (const stop of watchers.values()) stop();
  watchers.clear();
}
