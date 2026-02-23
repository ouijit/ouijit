import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import fixPath from 'fix-path';
import log from './log';
import { registerIpcHandlers, cleanupIpc } from './ipc/register';
import { typedPush } from './ipc/helpers';
import { getDatabase, closeDatabase } from './db/database';
import { ProjectRepo } from './db/repos/projectRepo';
import { TaskRepo } from './db/repos/taskRepo';
import { SettingsRepo } from './db/repos/settingsRepo';
import { HookRepo } from './db/repos/hookRepo';
import { importAll } from './services/dataImportService';

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
} else if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  // Isolate dev state from production so dev builds don't corrupt
  // production task-metadata.json, project settings, etc.
  app.setPath('userData', app.getPath('userData') + '-dev');
}

let mainWindow: BrowserWindow | null = null;

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
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
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

  return window;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  log.initialize(); // Inject preload for renderer IPC bridge
  appLog.info('app ready', { version: app.getVersion(), userData: app.getPath('userData') });

  // Initialize SQLite and migrate any existing JSON data
  const db = getDatabase();
  await importAll(
    db,
    new ProjectRepo(db),
    new TaskRepo(db),
    new SettingsRepo(db),
    new HookRepo(db),
  );

  mainWindow = createWindow();
  await registerIpcHandlers(mainWindow);
});

app.on('before-quit', () => {
  appLog.info('app quitting');
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
