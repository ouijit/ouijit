import { BrowserWindow } from 'electron';
import { typedHandle } from '../helpers';
import { getGlobalSetting, setGlobalSetting } from '../../db';
import { WINDOW_BACKGROUND_KEY, isWindowBackgroundColor } from '../../theme/themes';

/** Check if a settings key is allowed through the IPC boundary */
function isAllowedKey(key: string): boolean {
  return (
    key === 'lastActiveView' ||
    key === 'disableUpdates' ||
    key === 'disableReadyAudio' ||
    key === 'hasSeenWelcome' ||
    key.startsWith('canvas:') ||
    key.startsWith('experimental:') ||
    key.startsWith('terminal:') ||
    key.startsWith('lastSession:') ||
    key.startsWith('ui:') ||
    key.startsWith('worktree:') ||
    key.startsWith('onboarding:')
  );
}

/** Maximum value length (bytes) to prevent abuse */
const MAX_VALUE_LENGTH = 65536;

export function registerSettingsHandlers(): void {
  typedHandle('settings:get-global', (key) => {
    if (!isAllowedKey(key)) return undefined;
    return getGlobalSetting(key);
  });
  typedHandle('settings:set-global', (key, value) => {
    if (!isAllowedKey(key)) return { success: false };
    if (value.length > MAX_VALUE_LENGTH) return { success: false };
    // The renderer mirrors the resolved theme background here (see
    // src/theme/themeManager.ts); repaint the native window chrome to match
    // so live resize doesn't flash the previous theme's color.
    if (key === WINDOW_BACKGROUND_KEY && isWindowBackgroundColor(value)) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.setBackgroundColor(value);
      }
    }
    return setGlobalSetting(key, value);
  });
}
