import { typedHandle } from '../helpers';
import { getGlobalSetting, setGlobalSetting } from '../../db';

export function registerSettingsHandlers(): void {
  typedHandle('settings:get-global', (key) => getGlobalSetting(key));
  typedHandle('settings:set-global', (key, value) => setGlobalSetting(key, value));
}
