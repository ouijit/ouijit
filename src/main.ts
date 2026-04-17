import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import fixPath from 'fix-path';
import log from './log';
import { setLogger, type Logger } from './logger';
import { setUserDataPath, getDbPath, setCliPath } from './paths';
import { setTrashItem } from './platform';
import { registerIpcHandlers, cleanupIpc } from './ipc/register';
import { getActiveSessionCount } from './ptyManager';
import { typedPush } from './ipc/helpers';
import { initDatabase, closeDatabase } from './db/database';
import { ProjectRepo } from './db/repos/projectRepo';
import { TaskRepo } from './db/repos/taskRepo';
import { SettingsRepo } from './db/repos/settingsRepo';
import { HookRepo } from './db/repos/hookRepo';
import { importAll } from './services/dataImportService';
import { initUpdater, cleanupUpdater } from './updater';

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
  // Isolate dev state from production so dev builds don't corrupt
  // production task-metadata.json, project settings, etc.
  const devPath = app.getPath('userData') + '-dev';
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
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
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

  // Open the DevTools in development mode only
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.webContents.openDevTools();
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

  // Initialize SQLite and migrate any existing JSON data
  const db = initDatabase(getDbPath());
  await importAll(db, new ProjectRepo(db), new TaskRepo(db), new SettingsRepo(db), new HookRepo(db));

  mainWindow = createWindow();
  await registerIpcHandlers(mainWindow);
  initUpdater(mainWindow);
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
  cleanupUpdater();
  cleanupIpc();
  closeDatabase();
});

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
