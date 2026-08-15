import { BrowserWindow } from 'electron';
import { startHookServer, stopHookServer, installWrapper, migrateFromSettingsHooks } from '../hookServer';
import { cleanupAllPtys } from '../ptyManager';
import { registerSandboxProviders, cleanupSandboxProviders } from '../sandbox';
import { registerProjectHandlers } from './handlers/project';
import { registerGitHandlers } from './handlers/git';
import { registerPtyHandlers } from './handlers/pty';
import { registerTaskHandlers } from './handlers/task';
import { registerWorktreeHandlers } from './handlers/worktree';
import { registerHookHandlers } from './handlers/hooks';
import { registerTagHandlers } from './handlers/tags';
import { registerLimaHandlers } from './handlers/lima';
import { registerSandboxHandlers } from './handlers/sandbox';
import { registerSettingsHandlers } from './handlers/settings';
import { registerScriptHandlers } from './handlers/scripts';
import { registerPlanHandlers, cleanupPlanWatchers } from './handlers/plan';
import { registerHealthHandlers } from './handlers/health';
import { registerGithubHandlers } from './handlers/github';
import { registerDiffPanelHandlers } from './handlers/diffPanel';
import { initCliPanels } from '../cliPanels';

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

  // Register sandbox backends before PTY handlers so spawns can resolve them.
  registerSandboxProviders();

  registerProjectHandlers(mainWindow);
  registerGitHandlers();
  registerPtyHandlers(mainWindow);
  registerTaskHandlers();
  registerWorktreeHandlers();
  registerHookHandlers();
  registerTagHandlers();
  registerLimaHandlers(mainWindow);
  registerSandboxHandlers();
  registerSettingsHandlers();
  registerScriptHandlers();
  registerPlanHandlers(mainWindow);
  registerHealthHandlers();
  registerGithubHandlers();
  registerDiffPanelHandlers();
  initCliPanels(mainWindow);
}

/**
 * Cleanup function to be called when app is quitting
 */
export function cleanupIpc(): void {
  cleanupAllPtys();
  cleanupSandboxProviders();
  cleanupPlanWatchers();
  stopHookServer();
}
