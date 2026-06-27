import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import started from 'electron-squirrel-startup';
import fixPath from 'fix-path';
import log from './log';
import { setLogger, type Logger } from './logger';
import { setUserDataPath, getDbPath, setCliPath } from './paths';
import { setTrashItem } from './platform';
import { registerIpcHandlers, cleanupIpc } from './ipc/register';
import { getApiPort } from './hookServer';
import { getActiveSessionCount } from './ptyManager';
import { typedPush } from './ipc/helpers';
import * as fs from 'node:fs';
import { initDatabase, closeDatabase } from './db/database';
import { ProjectRepo } from './db/repos/projectRepo';
import { TaskRepo } from './db/repos/taskRepo';
import { SettingsRepo } from './db/repos/settingsRepo';
import { HookRepo } from './db/repos/hookRepo';
import { importAll } from './services/dataImportService';
import { initUpdater, cleanupUpdater } from './updater';
import { checkHealth } from './healthCheck';
import { setGlobalSetting, getGlobalSetting } from './db';
import {
  showTerminalWindow,
  destroyTerminalWindow,
  registerTerminalHotkey,
  unregisterTerminalHotkey,
  DEFAULT_TERMINAL_HOTKEY,
} from './terminalWindow';
import {
  CAPTURE_READY_SENTINEL,
  CAPTURE_WINDOW_HEIGHT,
  CAPTURE_WINDOW_WIDTH,
  getCaptureToken,
  isCaptureMode,
} from './capture/captureMode';
import { seedCaptureFixture } from './capture/fixture';
import { registerStaticToken } from './apiAuth';

/** Wraps electron-log to the Logger interface */
function createElectronLogAdapter(electronLog: typeof log): Logger {
  return {
    info: (msg, meta?) => (meta ? electronLog.info(msg, meta) : electronLog.info(msg)),
    warn: (msg, meta?) => (meta ? electronLog.warn(msg, meta) : electronLog.warn(msg)),
    error: (msg, meta?) => (meta ? electronLog.error(msg, meta) : electronLog.error(msg)),
    scope: (name) => {
      const scoped = electronLog.scope(name);
      const scopedLogger: Logger = {
        info: (msg, meta?) => (meta ? scoped.info(msg, meta) : scoped.info(msg)),
        warn: (msg, meta?) => (meta ? scoped.warn(msg, meta) : scoped.warn(msg)),
        error: (msg, meta?) => (meta ? scoped.error(msg, meta) : scoped.error(msg)),
        scope: (subName) => createElectronLogAdapter(electronLog).scope(`${name}:${subName}`),
      };
      return scopedLogger;
    },
  };
}

const appLog = log.scope('app');

// Suppress Chromium/DevTools errors for features not available in Electron
app.commandLine.appendSwitch('disable-features', 'Autofill,AutofillServerCommunication');

// Prevent EPIPE crashes when stdout/stderr aren't connected (packaged app launched from Finder/Dock)
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

// Fix PATH for packaged apps launched from Finder/Dock
// This sources the user's shell PATH so npm/node are available in PTY
fixPath();

// Allow E2E tests to isolate userData per instance
if (process.env.OUIJIT_TEST_USER_DATA) {
  app.setPath('userData', process.env.OUIJIT_TEST_USER_DATA);
  setUserDataPath(process.env.OUIJIT_TEST_USER_DATA);
} else if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  // Isolate dev state per worktree so multiple dev instances can run in parallel
  // without stomping on each other (and without touching production).
  const repoHash = createHash('sha256').update(app.getAppPath()).digest('hex').slice(0, 8);
  const devPath = `${app.getPath('userData')}-dev-${repoHash}`;
  app.setPath('userData', devPath);
  setUserDataPath(devPath);
} else {
  setUserDataPath(app.getPath('userData'));
}

// Set CLI path so PTY sessions can find the bundled ouijit CLI
if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  setCliPath(path.join(app.getAppPath(), 'dist-cli', 'ouijit.js'));
} else {
  setCliPath(path.join(app.getAppPath(), 'cli', 'ouijit.js'));
}

let mainWindow: BrowserWindow | null = null;
let quitConfirmed = false;
let tray: Tray | null = null;
let nativeResourcesCleaned = false;

/**
 * Tear down OS-level resources (status-bar tray, global shortcut, standalone
 * window). Idempotent so it can run from both `will-quit` and the termination
 * signal handlers below — the latter matter in dev, where electron-forge
 * SIGTERMs the old process on reload and `will-quit` never fires, orphaning the
 * tray icon in the menu bar until it's interacted with.
 */
function cleanupNativeResources(): void {
  if (nativeResourcesCleaned) return;
  nativeResourcesCleaned = true;
  try {
    unregisterTerminalHotkey();
  } catch {
    /* nothing registered */
  }
  try {
    destroyTerminalWindow();
  } catch {
    /* already gone */
  }
  if (tray) {
    try {
      tray.destroy();
    } catch {
      /* already gone */
    }
    tray = null;
  }
}

/** Resolve the tray/status-bar icon, falling back gracefully if missing. */
function resolveTrayIcon(): Electron.NativeImage {
  // Packaged: <app>/icon.png (copied by forge afterCopy). Dev: source asset.
  const iconPath = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? path.join(__dirname, '..', '..', 'src', 'assets', 'icons', 'icon.png')
    : path.join(__dirname, '..', '..', 'icon.png');
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? image : image.resize({ width: 18, height: 18 });
}

/**
 * Wire the three entry points for the standalone terminal window: a global
 * hotkey, a dock menu item (macOS), and a status-bar tray item. All three call
 * the same toggle/show handler.
 */
async function setupTerminalWindowTriggers(): Promise<void> {
  // Global hotkey — user-overridable via the `terminal:hotkey` global setting
  // (no UI yet), falling back to the default accelerator.
  let accelerator = DEFAULT_TERMINAL_HOTKEY;
  try {
    const stored = await getGlobalSetting('terminal:hotkey');
    if (stored && stored.trim()) accelerator = stored.trim();
  } catch {
    /* settings unavailable — use the default */
  }
  if (!registerTerminalHotkey(accelerator)) {
    appLog.warn('failed to register terminal hotkey (already taken?)', { accelerator });
  }

  // Dock menu (macOS only).
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(Menu.buildFromTemplate([{ label: 'New Terminal', click: () => showTerminalWindow() }]));
  }

  // Status-bar tray item (macOS + Linux).
  try {
    const icon = resolveTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('Ouijit Terminal');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Terminal', click: () => showTerminalWindow() },
        { type: 'separator' },
        {
          label: 'Quit Ouijit',
          click: () => {
            quitConfirmed = true;
            app.quit();
          },
        },
      ]),
    );
    // Left-clicking the tray icon opens the terminal directly.
    tray.on('click', () => showTerminalWindow());
  } catch (err) {
    appLog.error('failed to create tray', { error: err instanceof Error ? err.message : String(err) });
  }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = (): BrowserWindow => {
  // Determine background color based on system theme
  const isDark = nativeTheme.shouldUseDarkColors;
  const backgroundColor = isDark ? '#1C1C1E' : '#F5F5F7';

  // Create the browser window.
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const captureMode = isCaptureMode();
  const width = captureMode ? CAPTURE_WINDOW_WIDTH : 1200;
  const height = captureMode ? CAPTURE_WINDOW_HEIGHT : 800;
  const window = new BrowserWindow({
    width,
    height,
    minWidth: captureMode ? width : 600,
    minHeight: captureMode ? height : 400,
    useContentSize: captureMode,
    // macOS: hidden title bar with inset traffic lights
    // Linux/Windows: use default frame (has native window controls)
    ...(isMac && { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }),
    // Linux needs explicit icon (macOS uses .icns from app bundle)
    ...(isLinux && { icon: path.join(__dirname, '..', '..', 'icon.png') }),
    backgroundColor,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools in development mode only — capture mode keeps them closed
  // so screenshots aren't polluted by the detached debugger window.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL && !captureMode) {
    window.webContents.openDevTools();
  }

  // Capture mode: pin the window to a known position so the driver can use
  // screencapture -R with fixed coordinates (pid → window-id resolution via
  // System Events is fragile). Also emit a sentinel so logs still show the
  // load marker.
  if (captureMode) {
    window.setPosition(100, 50);
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        process.stdout.write(`${CAPTURE_READY_SENTINEL}\n`);
      }, 250);
    });
  }

  // Prevent links from opening inside the Electron window.
  // Intercept window.open() calls (e.g. target="_blank" links) and open in
  // the system default browser instead of spawning an Electron popup.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Lock down <webview> elements used for web preview panels. We strip node
  // integration, disable the preload script, and prevent new window spawns so
  // an embedded dev server page can't escape the sandbox.
  window.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;

    // Only allow http(s) URLs. A bad src attribute can't ship us to a file:// page.
    if (!/^https?:\/\//i.test(params.src || '')) {
      params.src = 'about:blank';
    }
  });

  // Prevent the main window from navigating away to an external URL.
  window.webContents.on('will-navigate', (event, url) => {
    // Allow dev-server reloads but block everything else.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL && url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Notify renderer of fullscreen state changes
  window.on('enter-full-screen', () => {
    typedPush(window, 'fullscreen-change', true);
  });
  window.on('leave-full-screen', () => {
    typedPush(window, 'fullscreen-change', false);
  });

  // Confirm before closing via window close button if terminal sessions are active
  window.on('close', (e) => {
    if (quitConfirmed) return;

    const count = getActiveSessionCount();
    if (count === 0 || process.env.OUIJIT_E2E === '1') return;

    e.preventDefault();
    const s = count === 1 ? 'session' : 'sessions';
    dialog
      .showMessageBox(window, {
        type: 'question',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: 'Quit Ouijit?',
        detail: `You have ${count} active terminal ${s} that will be terminated.`,
      })
      .then(({ response }) => {
        if (response === 0) {
          quitConfirmed = true;
          app.quit();
        }
      });
  });

  return window;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  log.initialize(); // Inject preload for renderer IPC bridge
  setLogger(createElectronLogAdapter(log));
  setTrashItem((p) => shell.trashItem(p));
  appLog.info('app ready', { version: app.getVersion(), userData: app.getPath('userData') });

  // Initialize SQLite. In capture mode we skip the legacy-JSON import so
  // the user's real projects (read from ~/Ouijit/added-projects.json) don't
  // end up in the temp DB and displace the fixture.
  const db = initDatabase(getDbPath());
  if (!isCaptureMode()) {
    await importAll(db, new ProjectRepo(db), new TaskRepo(db), new SettingsRepo(db), new HookRepo(db));
  }

  // Capture mode: register the driver's pre-shared token so it can hit the
  // REST API without needing to spawn a PTY first, and seed fixture data
  // into the temp DB.
  if (isCaptureMode()) {
    const token = getCaptureToken();
    if (token) registerStaticToken(token, 'capture-driver', 'host');

    const projectPath = process.env.OUIJIT_CAPTURE_PROJECT_PATH;
    const projectName = process.env.OUIJIT_CAPTURE_PROJECT_NAME;
    if (!projectPath || !projectName) {
      appLog.error('capture fixture missing OUIJIT_CAPTURE_PROJECT_PATH/NAME');
    } else {
      try {
        seedCaptureFixture(db, { projectPath, projectName });
      } catch (err) {
        appLog.error('capture fixture seed failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  mainWindow = createWindow();
  await registerIpcHandlers(mainWindow);

  if (isCaptureMode()) {
    // Write the hook server port + actual window bounds to a well-known
    // file after the renderer finishes first paint, so the driver has
    // ground-truth coordinates for `screencapture -R`.
    const writeInfo = () => {
      try {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
        const bounds = mainWindow.getContentBounds();
        // getMediaSourceId returns "window:<cgwindowid>:0" on macOS — this is
        // the id `screencapture -l` expects (AXWindow ids from System Events
        // do NOT work).
        const mediaSourceId = mainWindow.getMediaSourceId();
        const match = /^window:(\d+):/.exec(mediaSourceId);
        const cgWindowId = match ? match[1] : null;
        const infoPath = path.join(app.getPath('userData'), 'capture-info.json');
        fs.writeFileSync(
          infoPath,
          JSON.stringify({
            port: getApiPort(),
            pid: process.pid,
            bounds,
            cgWindowId,
            mediaSourceId,
          }),
        );
        appLog.info('capture info written', { bounds, cgWindowId });
      } catch (err) {
        appLog.error('capture info write failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', () => setTimeout(writeInfo, 400));
    } else {
      setTimeout(writeInfo, 400);
    }
  } else {
    initUpdater(mainWindow);
  }

  // Health probe (git/claude/lima detection) — push to renderer once it's ready
  if (!isCaptureMode() && mainWindow) {
    const pushHealth = async () => {
      const status = await checkHealth();
      if (mainWindow) typedPush(mainWindow, 'health', status);
    };
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', pushHealth);
    } else {
      pushHealth();
    }
  }

  // E2E suite expects no welcome dialog interfering with existing flows.
  // Pre-set the seen flag so the renderer's first-run pull treats it as already shown.
  if (process.env.OUIJIT_E2E === '1') {
    await setGlobalSetting('hasSeenWelcome', '1');
  }

  // Standalone terminal window entry points (hotkey, dock, tray). Skipped in
  // capture mode so screenshots aren't perturbed by a global shortcut or tray.
  if (!isCaptureMode()) {
    await setupTerminalWindowTriggers();
  }
});

app.on('before-quit', (e) => {
  if (quitConfirmed) return;

  const count = getActiveSessionCount();
  if (count === 0 || process.env.OUIJIT_E2E === '1') return;

  e.preventDefault();
  const s = count === 1 ? 'session' : 'sessions';
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const opts = {
    type: 'question' as const,
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Quit Ouijit?',
    detail: `You have ${count} active terminal ${s} that will be terminated.`,
  };
  (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)).then(({ response }) => {
    if (response === 0) {
      quitConfirmed = true;
      app.quit();
    }
  });
});

app.on('will-quit', () => {
  appLog.info('app quitting');
  cleanupNativeResources();
  cleanupUpdater();
  cleanupIpc();
  closeDatabase();
});

// Terminate gracefully on signals so OS resources (notably the status-bar tray
// icon) are released. In dev, electron-forge SIGTERMs the previous process on
// reload; without this the tray icon would orphan in the menu bar. Registering
// a handler suppresses Node's default terminate-on-signal, so we must quit
// ourselves. `quitConfirmed` skips the active-sessions prompt in before-quit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    cleanupNativeResources();
    quitConfirmed = true;
    app.quit();
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
