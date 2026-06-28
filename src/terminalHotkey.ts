/**
 * Default global hotkey that toggles the standalone terminal window. Shared
 * between the main process (which registers it) and the renderer settings UI
 * (which compares against it to decide whether to offer "Reset"). Kept in a
 * dependency-free module so both bundles can import it without coupling.
 */
export const DEFAULT_TERMINAL_HOTKEY = 'Control+`';
