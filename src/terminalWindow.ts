import { BrowserWindow, globalShortcut, nativeTheme, shell } from 'electron';
import path from 'node:path';
import log from './log';

const terminalWindowLog = log.scope('terminalWindow');

// Re-exported so main-process consumers can keep importing it from here.
export { DEFAULT_TERMINAL_HOTKEY } from './terminalHotkey';

/** The accelerator currently bound to {@link toggleTerminalWindow}, if any. */
let registeredHotkey: string | null = null;

/** Notified whenever the hotkey is (re)bound, so the tray menu can disclose the
 *  current accelerator. */
let hotkeyChangeListener: ((accelerator: string) => void) | null = null;

/** Register a listener invoked each time the hotkey is successfully bound. */
export function setHotkeyChangeListener(listener: (accelerator: string) => void): void {
  hotkeyChangeListener = listener;
}

/**
 * The standalone terminal window — a "regular" terminal detached from the main
 * app window, opened via the global hotkey, the dock menu, or the status-bar
 * item. It hosts home-directory shells with none of the project/kanban chrome.
 *
 * There is at most one instance. Closing it hides rather than destroys it, so
 * its shells survive across toggles and the next toggle is instant.
 */
let terminalWindow: BrowserWindow | null = null;

/** Query flag the renderer reads to mount the standalone terminal view. */
const STANDALONE_FLAG = 'mode=standalone';

function loadStandaloneRenderer(window: BrowserWindow): void {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${STANDALONE_FLAG}`);
  } else {
    window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
      search: STANDALONE_FLAG,
    });
  }
}

function createTerminalWindow(): BrowserWindow {
  const isDark = nativeTheme.shouldUseDarkColors;
  const backgroundColor = isDark ? '#171717' : '#F5F5F7';
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  const window = new BrowserWindow({
    width: 760,
    height: 520,
    minWidth: 400,
    minHeight: 240,
    show: false,
    backgroundColor,
    title: 'Terminal',
    // macOS: hidden title bar with inset traffic lights, matching the main window.
    ...(isMac && { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }),
    ...(isLinux && { icon: path.join(__dirname, '..', '..', 'icon.png') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  loadStandaloneRenderer(window);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  // Open http(s) links in the system browser rather than spawning popups.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block navigation away from the app (allow dev-server reloads only).
  window.webContents.on('will-navigate', (event, url) => {
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL && url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Hide instead of close so the shells inside keep running and the next toggle
  // is instant. The window is only truly destroyed on app quit.
  window.on('close', (event) => {
    if (terminalWindow !== window) return; // app is quitting — allow destroy
    event.preventDefault();
    window.hide();
  });

  terminalWindowLog.info('created standalone terminal window');
  return window;
}

/**
 * Show and focus the standalone terminal window, creating it on first use.
 */
export function showTerminalWindow(): void {
  if (!terminalWindow || terminalWindow.isDestroyed()) {
    terminalWindow = createTerminalWindow();
  }
  terminalWindow.show();
  terminalWindow.focus();
}

/**
 * Toggle the standalone terminal window — the behavior bound to the global
 * hotkey. Hides it when it's already the focused, visible window; otherwise
 * creates/shows and focuses it.
 */
export function toggleTerminalWindow(): void {
  if (terminalWindow && !terminalWindow.isDestroyed() && terminalWindow.isVisible() && terminalWindow.isFocused()) {
    terminalWindow.hide();
    return;
  }
  showTerminalWindow();
}

/**
 * Bind a global hotkey to the standalone terminal window toggle, replacing any
 * previously bound accelerator. Returns false (and restores the previous
 * binding) when the accelerator is invalid or already taken by another app, so
 * the caller can surface the failure without losing the working hotkey.
 */
export function registerTerminalHotkey(accelerator: string): boolean {
  const previous = registeredHotkey;
  if (previous) {
    try {
      globalShortcut.unregister(previous);
    } catch {
      /* wasn't registered */
    }
    registeredHotkey = null;
  }
  try {
    const ok = globalShortcut.register(accelerator, toggleTerminalWindow);
    if (ok) {
      registeredHotkey = accelerator;
      hotkeyChangeListener?.(accelerator);
      return true;
    }
  } catch (err) {
    terminalWindowLog.warn('hotkey registration threw', {
      accelerator,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // Registration failed — try to restore the previous binding.
  if (previous) {
    try {
      if (globalShortcut.register(previous, toggleTerminalWindow)) registeredHotkey = previous;
    } catch {
      /* give up — no hotkey bound */
    }
  }
  return false;
}

/** Unregister the standalone terminal hotkey (app quit / signal cleanup). */
export function unregisterTerminalHotkey(): void {
  if (!registeredHotkey) return;
  try {
    globalShortcut.unregister(registeredHotkey);
  } catch {
    /* already gone */
  }
  registeredHotkey = null;
}

/**
 * Destroy the standalone terminal window for good (app quit). Clears the
 * module reference first so the close handler allows the real destroy.
 */
export function destroyTerminalWindow(): void {
  const window = terminalWindow;
  terminalWindow = null;
  if (window && !window.isDestroyed()) {
    window.destroy();
  }
}
