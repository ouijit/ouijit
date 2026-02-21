import { BrowserWindow } from 'electron';
import { startHookServer, stopHookServer, installHooks } from '../hookServer';
import { cleanupAllPtys } from '../ptyManager';
import { cleanup as limaCleanup } from '../lima';
import { registerProjectHandlers } from './handlers/project';
import { registerGitHandlers } from './handlers/git';
import { registerPtyHandlers } from './handlers/pty';
import { registerTaskHandlers } from './handlers/task';
import { registerWorktreeHandlers } from './handlers/worktree';
import { registerHookHandlers } from './handlers/hooks';
import { registerLimaHandlers } from './handlers/lima';

/**
 * Registers all IPC handlers for the main process.
 * Domain registration functions are called sequentially to preserve initialization ordering —
 * the hook server must start before any PTY handlers are registered.
 */
export async function registerIpcHandlers(mainWindow: BrowserWindow): Promise<void> {
  // Start hook API server (must be ready before any PTY spawns)
  await startHookServer(mainWindow);
  installHooks();

  registerProjectHandlers(mainWindow);
  registerGitHandlers();
  registerPtyHandlers(mainWindow);
  registerTaskHandlers();
  registerWorktreeHandlers();
  registerHookHandlers();
  registerLimaHandlers(mainWindow);
}

/**
 * Cleanup function to be called when app is quitting
 */
export function cleanupIpc(): void {
  cleanupAllPtys();
  limaCleanup();
  stopHookServer();
}
