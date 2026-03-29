import { app, BrowserWindow, net } from 'electron';
import { updateElectronApp, UpdateSourceType } from 'update-electron-app';
import log from './log';
import { typedPush } from './ipc/helpers';
import { getGlobalSetting, setGlobalSetting } from './db';

const updaterLog = log.scope('updater');

const REPO = 'ouijit/ouijit';
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

/** Compare two semver strings (X.Y.Z). Returns true if a > b. */
export function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

function initMacUpdater(): void {
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: REPO,
    },
    updateInterval: '1 hour',
    logger: updaterLog,
  });
  updaterLog.info('macOS auto-updater initialized');
}

let lastNotifiedVersion: string | null = null;

export async function checkForLinuxUpdate(mainWindow: BrowserWindow): Promise<void> {
  try {
    const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      updaterLog.warn('GitHub API error', { status: response.status });
      return;
    }

    const release = (await response.json()) as { tag_name: string; html_url: string };
    const latestVersion = release.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();

    if (semverGt(latestVersion, currentVersion) && latestVersion !== lastNotifiedVersion) {
      lastNotifiedVersion = latestVersion;
      typedPush(mainWindow, 'update-available', { version: latestVersion, url: release.html_url });
      updaterLog.info('update available', { current: currentVersion, latest: latestVersion });
    }
  } catch (error) {
    updaterLog.warn('update check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function initLinuxUpdater(mainWindow: BrowserWindow): void {
  const check = () => checkForLinuxUpdate(mainWindow);
  check();
  setInterval(check, CHECK_INTERVAL);
  updaterLog.info('Linux update checker initialized');
}

export async function checkWhatsNew(mainWindow: BrowserWindow): Promise<void> {
  try {
    const currentVersion = app.getVersion();
    const lastSeen = await getGlobalSetting('lastSeenVersion');

    if (lastSeen === currentVersion) return;

    // Update immediately so we only show once, even if the fetch fails
    await setGlobalSetting('lastSeenVersion', currentVersion);

    // Don't show on first launch (no previous version recorded)
    if (!lastSeen) return;

    // Only show when the version actually increased (not a downgrade)
    if (!semverGt(currentVersion, lastSeen)) return;

    const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${currentVersion}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      updaterLog.warn('failed to fetch release notes', { status: response.status });
      return;
    }

    const release = (await response.json()) as { body: string | null };
    const notes = release.body?.trim();
    if (!notes) return;

    typedPush(mainWindow, 'whats-new', { version: currentVersion, notes });
    updaterLog.info('showing whats new', { version: currentVersion });
  } catch (error) {
    updaterLog.warn('whats new check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function _resetForTesting(): void {
  lastNotifiedVersion = null;
}

export function initUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    updaterLog.info('skipping updates in dev mode');
    return;
  }

  if (process.platform === 'darwin') {
    initMacUpdater();
  } else if (process.platform === 'linux') {
    initLinuxUpdater(mainWindow);
  }

  checkWhatsNew(mainWindow);
}
