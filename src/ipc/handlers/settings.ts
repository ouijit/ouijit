import { typedHandle } from '../helpers';
import { getGlobalSetting, setGlobalSetting, getProjectLayout, setProjectLayout, getProjectGridRatios, setProjectGridRatios } from '../../db';

/** Only these keys are permitted through the IPC boundary */
const ALLOWED_KEYS = new Set(['lastActiveView', 'terminalLayout', 'gridRatios']);

/** Maximum value length (bytes) to prevent abuse */
const MAX_VALUE_LENGTH = 4096;

const VALID_LAYOUTS = new Set(['stack', 'grid', 'focus']);

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

  // Per-project layout
  typedHandle('settings:get-project-layout', (projectPath) => {
    return getProjectLayout(projectPath);
  });
  typedHandle('settings:set-project-layout', (projectPath, layout) => {
    if (!VALID_LAYOUTS.has(layout)) return { success: false };
    return setProjectLayout(projectPath, layout);
  });

  // Per-project grid ratios
  typedHandle('settings:get-project-grid-ratios', (projectPath) => {
    return getProjectGridRatios(projectPath);
  });
  typedHandle('settings:set-project-grid-ratios', (projectPath, ratios) => {
    if (ratios.length > MAX_VALUE_LENGTH) return { success: false };
    return setProjectGridRatios(projectPath, ratios);
  });
}
