import { BrowserWindow } from 'electron';
import { startHookServer, stopHookServer, installWrapper, migrateFromSettingsHooks } from '../hookServer';
import { cleanupAllPtys } from '../ptyManager';
import { cleanup as limaCleanup } from '../lima';
import { registerProjectHandlers } from './handlers/project';
import { registerGitHandlers } from './handlers/git';
import { registerPtyHandlers } from './handlers/pty';
import { registerTaskHandlers } from './handlers/task';
import { registerWorktreeHandlers } from './handlers/worktree';
import { registerHookHandlers } from './handlers/hooks';
import { registerTagHandlers } from './handlers/tags';
import { registerLimaHandlers } from './handlers/lima';
import { registerSettingsHandlers } from './handlers/settings';
import { registerScriptHandlers } from './handlers/scripts';

/**
 * Registers all IPC handlers for the main process.
 * Domain registration functions are called sequentially to preserve initialization ordering —
 * the hook server must start before any PTY handlers are registered.
 */
export async function registerIpcHandlers(mainWindow: BrowserWindow): Promise<void> {
  // Start hook API server (must be ready before any PTY spawns)
  await startHookServer(mainWindow);
  installWrapper();
  migrateFromSettingsHooks();

  registerProjectHandlers(mainWindow);
  registerGitHandlers();
  registerPtyHandlers(mainWindow);
  registerTaskHandlers();
  registerWorktreeHandlers();
  registerHookHandlers();
  registerTagHandlers();
  registerLimaHandlers(mainWindow);
  registerSettingsHandlers();
  registerScriptHandlers();
}

/**
 * Cleanup function to be called when app is quitting
 */
export function cleanupIpc(): void {
  cleanupAllPtys();
  limaCleanup();
  stopHookServer();
}
