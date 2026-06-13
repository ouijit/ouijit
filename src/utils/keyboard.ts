/**
 * Shortcuts that belong to Electron / the OS, not the terminal.
 *
 * ghostty-web's input handler calls preventDefault on every key it processes,
 * so when a terminal is focused these would be swallowed. Both the home and
 * project capture-phase keydown handlers call this — keeping behavior identical
 * across views — to stop the event before it reaches the terminal WITHOUT
 * preventing the default, so Electron's native accelerators (reload, quit)
 * still fire.
 *
 * The caller must have already confirmed the platform modifier (Cmd/Ctrl) is
 * held. Returns true if the event was a system shortcut and was handled (the
 * caller should then return).
 */
export function passThroughSystemShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  if (key === 'r' || key === 'q') {
    e.stopPropagation();
    return true;
  }
  return false;
}
