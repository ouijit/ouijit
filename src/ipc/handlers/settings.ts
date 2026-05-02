import { typedHandle } from '../helpers';
import { getGlobalSetting, setGlobalSetting } from '../../db';

/** Check if a settings key is allowed through the IPC boundary */
function isAllowedKey(key: string): boolean {
  return (
    key === 'lastActiveView' ||
    key === 'disableUpdates' ||
    key === 'hasSeenWelcome' ||
    key.startsWith('canvas:') ||
    key.startsWith('experimental:') ||
    key.startsWith('terminal:')
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
    return setGlobalSetting(key, value);
  });
}
