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
import { registerPlanHandlers, cleanupPlanWatchers } from './handlers/plan';
import { registerHealthHandlers } from './handlers/health';
import { registerSessionHandlers } from './handlers/session';
import { initSessionManager, shutdownSessionManager } from '../sessions';

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
  registerPlanHandlers(mainWindow);
  registerHealthHandlers();

  // Durable sessions (#462): build the manager, rehydrate dormant sessions from
  // the last run, and expose the session channels. Bound to the current window
  // by reference so the event stream follows a renderer reload.
  initSessionManager(() => (mainWindow.isDestroyed() ? null : mainWindow));
  registerSessionHandlers();
}

/**
 * Cleanup function to be called when app is quitting
 */
export function cleanupIpc(): void {
  // Persist durable sessions before their processes are torn down.
  shutdownSessionManager();
  cleanupAllPtys();
  limaCleanup();
  cleanupPlanWatchers();
  stopHookServer();
}
