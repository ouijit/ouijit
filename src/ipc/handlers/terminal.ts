import { typedHandle } from '../helpers';
import { getGlobalSetting, setGlobalSetting } from '../../db';
import { registerTerminalHotkey, DEFAULT_TERMINAL_HOTKEY } from '../../terminalWindow';

/**
 * Handlers for the standalone terminal window's global hotkey. The renderer's
 * settings UI reads the current accelerator and sets a new one; setting it
 * re-registers the global shortcut immediately and persists the choice.
 */
export function registerTerminalHandlers(): void {
  typedHandle('terminal:get-hotkey', async () => {
    const stored = await getGlobalSetting('terminal:hotkey');
    return stored && stored.trim() ? stored.trim() : DEFAULT_TERMINAL_HOTKEY;
  });

  typedHandle('terminal:set-hotkey', async (accelerator) => {
    const trimmed = accelerator.trim();
    // Empty resets to the default.
    const target = trimmed || DEFAULT_TERMINAL_HOTKEY;
    const success = registerTerminalHotkey(target);
    if (success) {
      // Persist the explicit choice; store '' when it's just the default so a
      // future default change is picked up.
      await setGlobalSetting('terminal:hotkey', trimmed && target !== DEFAULT_TERMINAL_HOTKEY ? target : '');
    }
    return { success, accelerator: target };
  });
}
