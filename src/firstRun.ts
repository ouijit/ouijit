import { BrowserWindow } from 'electron';
import { typedPush } from './ipc/helpers';
import { getGlobalSetting, setGlobalSetting } from './db';
import { getLogger } from './logger';

const firstRunLog = getLogger().scope('firstRun');

const FLAG = 'hasSeenWelcome';

export async function checkFirstRun(mainWindow: BrowserWindow): Promise<void> {
  // E2E suite drives the welcome dialog explicitly; suppress the automatic firing so
  // the existing test flow (no project, fresh user data) isn't blocked by an overlay.
  if (process.env.OUIJIT_E2E === '1') return;

  try {
    const seen = await getGlobalSetting(FLAG);
    if (seen) return;
    typedPush(mainWindow, 'welcome');
    await setGlobalSetting(FLAG, '1');
    firstRunLog.info('first-run welcome dispatched');
  } catch (error) {
    firstRunLog.warn('first-run check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
