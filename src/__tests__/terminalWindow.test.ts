/**
 * Lifecycle tests for the standalone terminal window: it is created lazily,
 * toggled show/hide, reused across toggles, hidden (not destroyed) on close,
 * and fully torn down on app quit.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared registry of fake windows the mocked electron BrowserWindow pushes into.
const { windows } = vi.hoisted(() => ({ windows: [] as FakeWindow[] }));

interface FakeWindow {
  visible: boolean;
  focused: boolean;
  destroyed: boolean;
  closeHandlers: Array<(event: { preventDefault: () => void }) => void>;
  show(): void;
  focus(): void;
  hide(): void;
  isVisible(): boolean;
  isFocused(): boolean;
  isDestroyed(): boolean;
  destroy(): void;
  triggerClose(event: { preventDefault: () => void }): void;
}

vi.mock('electron', () => {
  class FakeBrowserWindow implements FakeWindow {
    visible = false;
    focused = false;
    destroyed = false;
    closeHandlers: Array<(event: { preventDefault: () => void }) => void> = [];
    webContents = {
      openDevTools: () => {},
      setWindowOpenHandler: () => {},
      on: () => {},
    };
    constructor() {
      windows.push(this);
    }
    loadURL() {}
    loadFile() {}
    on(event: string, cb: (event: { preventDefault: () => void }) => void) {
      if (event === 'close') this.closeHandlers.push(cb);
      return this;
    }
    show() {
      this.visible = true;
    }
    focus() {
      this.focused = true;
    }
    hide() {
      this.visible = false;
      this.focused = false;
    }
    isVisible() {
      return this.visible;
    }
    isFocused() {
      return this.focused;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
    triggerClose(event: { preventDefault: () => void }) {
      for (const handler of this.closeHandlers) handler(event);
    }
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    nativeTheme: { shouldUseDarkColors: true },
    shell: { openExternal: () => {} },
  };
});

import { showTerminalWindow, toggleTerminalWindow, destroyTerminalWindow } from '../terminalWindow';

beforeEach(() => {
  windows.length = 0;
  (globalThis as Record<string, unknown>).MAIN_WINDOW_VITE_DEV_SERVER_URL = '';
  (globalThis as Record<string, unknown>).MAIN_WINDOW_VITE_NAME = 'main_window';
});

afterEach(() => {
  // Reset the module's internal singleton between tests.
  destroyTerminalWindow();
});

describe('standalone terminal window', () => {
  test('showTerminalWindow creates, shows, and focuses the window', () => {
    showTerminalWindow();
    expect(windows).toHaveLength(1);
    expect(windows[0].isVisible()).toBe(true);
    expect(windows[0].isFocused()).toBe(true);
  });

  test('toggle hides the window when it is visible and focused', () => {
    showTerminalWindow();
    toggleTerminalWindow();
    expect(windows).toHaveLength(1);
    expect(windows[0].isVisible()).toBe(false);
  });

  test('toggle reuses the same window when reopening', () => {
    showTerminalWindow();
    toggleTerminalWindow(); // hide
    toggleTerminalWindow(); // show again
    expect(windows).toHaveLength(1);
    expect(windows[0].isVisible()).toBe(true);
  });

  test('closing the window hides it instead of destroying it', () => {
    showTerminalWindow();
    const win = windows[0];
    const event = { preventDefault: vi.fn() };
    win.triggerClose(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.isDestroyed()).toBe(false);
    expect(win.isVisible()).toBe(false);
  });

  test('destroy tears the window down so the next show creates a fresh one', () => {
    showTerminalWindow();
    const first = windows[0];
    destroyTerminalWindow();
    expect(first.isDestroyed()).toBe(true);
    showTerminalWindow();
    expect(windows).toHaveLength(2);
    expect(windows[1].isVisible()).toBe(true);
  });
});
