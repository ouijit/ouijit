import { app, autoUpdater, BrowserWindow, dialog, net } from 'electron';
import { getLogger } from './logger';
import { typedPush } from './ipc/helpers';
import { getGlobalSetting, setGlobalSetting } from './db';
import { semverGt } from './utils/semver';

const updaterLog = getLogger().scope('updater');

const REPO = 'ouijit/ouijit';
const CHECK_INTERVAL = 60 * 60 * 1000;

let updateIntervalId: ReturnType<typeof setInterval> | null = null;

type Release = { version: string; url: string };

async function fetchLatestRelease(): Promise<Release | null> {
  try {
    const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      updaterLog.warn('GitHub API error', { status: response.status });
      return null;
    }

    const release = (await response.json()) as { tag_name: string; html_url: string };
    return { version: release.tag_name.replace(/^v/, ''), url: release.html_url };
  } catch (error) {
    updaterLog.warn('release lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Squirrel.Mac downloads the whole ~100MB zip on every checkForUpdates and
 * keeps no record of what it already staged, so an app left running with the
 * restart prompt deferred would re-fetch the same update every hour. Once
 * something is staged, only a strictly newer release earns another check —
 * and if the feed never named the staged version, nothing does until restart.
 */
let stagedVersion: string | null = null;
let hasStagedUpdate = false;

async function checkForMacUpdate(): Promise<void> {
  if (hasStagedUpdate) {
    if (!stagedVersion) return;
    const latest = await fetchLatestRelease();
    if (!latest || !semverGt(latest.version, stagedVersion)) return;
    updaterLog.info('newer release than the staged update', {
      staged: stagedVersion,
      latest: latest.version,
    });
  }
  autoUpdater.checkForUpdates();
}

function promptRestart(releaseName: string | undefined): void {
  dialog
    .showMessageBox({
      type: 'info',
      buttons: ['Restart', 'Later'],
      title: 'Update Ready',
      message: releaseName ? `Ouijit ${releaseName} is ready to install` : 'A new version is ready to install',
      detail: 'Restart to finish updating.',
    })
    .then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
}

function initMacUpdater(): void {
  const feedURL = `https://update.electronjs.org/${REPO}/${process.platform}-${process.arch}/${app.getVersion()}`;

  autoUpdater.setFeedURL({
    url: feedURL,
    headers: { 'User-Agent': `${app.getName()}/${app.getVersion()} (${process.platform}: ${process.arch})` },
  });

  autoUpdater.on('error', (error) => {
    updaterLog.warn('updater error', { error: error.message });
  });
  autoUpdater.on('update-available', () => {
    updaterLog.info('update available, downloading');
  });
  autoUpdater.on('update-not-available', () => {
    updaterLog.info('no update available');
  });
  autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
    hasStagedUpdate = true;
    stagedVersion = releaseName ? releaseName.replace(/^v/, '') : null;
    updaterLog.info('update downloaded', { version: stagedVersion });
    promptRestart(releaseName);
  });

  const check = () => checkForMacUpdate();
  check();
  updateIntervalId = setInterval(check, CHECK_INTERVAL);
  updaterLog.info('macOS auto-updater initialized', { feedURL });
}

let lastNotifiedVersion: string | null = null;

export async function checkForLinuxUpdate(mainWindow: BrowserWindow): Promise<void> {
  const release = await fetchLatestRelease();
  if (!release) return;

  const currentVersion = app.getVersion();

  if (semverGt(release.version, currentVersion) && release.version !== lastNotifiedVersion) {
    lastNotifiedVersion = release.version;
    typedPush(mainWindow, 'update-available', { version: release.version, url: release.url });
    updaterLog.info('update available', { current: currentVersion, latest: release.version });
  }
}

function initLinuxUpdater(mainWindow: BrowserWindow): void {
  const check = () => checkForLinuxUpdate(mainWindow);
  check();
  updateIntervalId = setInterval(check, CHECK_INTERVAL);
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

export function cleanupUpdater(): void {
  if (updateIntervalId) {
    clearInterval(updateIntervalId);
    updateIntervalId = null;
  }
}

export function _resetForTesting(): void {
  lastNotifiedVersion = null;
  stagedVersion = null;
  hasStagedUpdate = false;
  cleanupUpdater();
}

export async function initUpdater(mainWindow: BrowserWindow): Promise<void> {
  if (process.env.OUIJIT_DISABLE_UPDATES === '1') {
    updaterLog.info('updates disabled by env var');
    return;
  }

  if ((await getGlobalSetting('disableUpdates')) === '1') {
    updaterLog.info('updates disabled by setting');
    return;
  }

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
