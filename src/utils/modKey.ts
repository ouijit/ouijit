const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

/**
 * The platform's command modifier: Cmd on macOS, Ctrl elsewhere.
 *
 * Deliberately not `metaKey || ctrlKey`. Accepting either binds Ctrl+letter on
 * macOS too, which shadows the system emacs bindings that work in every text
 * field — Ctrl+E for end-of-line, Ctrl+A for start, Ctrl+K to kill the line.
 * The board's own hotkeys already resolve the modifier this way.
 */
export function isModKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** Label for the same modifier, for tooltips and key hints. */
export const MOD_LABEL = isMac ? '⌘' : 'Ctrl ';
