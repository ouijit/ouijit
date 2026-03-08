import { typedHandle } from '../helpers';
import { getGlobalSetting, setGlobalSetting } from '../../db';

/** Only these keys are permitted through the IPC boundary */
const ALLOWED_KEYS = new Set(['lastActiveView']);

/** Maximum value length (bytes) to prevent abuse */
const MAX_VALUE_LENGTH = 4096;

export function registerSettingsHandlers(): void {
  typedHandle('settings:get-global', (key) => {
    if (!ALLOWED_KEYS.has(key)) return undefined;
    return getGlobalSetting(key);
  });
  typedHandle('settings:set-global', (key, value) => {
    if (!ALLOWED_KEYS.has(key)) return { success: false };
    if (value.length > MAX_VALUE_LENGTH) return { success: false };
    return setGlobalSetting(key, value);
  });
}
