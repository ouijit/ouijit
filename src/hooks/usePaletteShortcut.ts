import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

/**
 * Mod+K toggles the command palette.
 *
 * Registered once at the app level so it works from every view, in capture
 * phase so a focused xterm can't swallow it (`terminalReact` also lists `k` in
 * its app-hotkey passthrough, for the case where the event reaches xterm first).
 */
export function usePaletteShortcut(): void {
  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      e.stopPropagation();
      useUIStore.getState().togglePalette();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}
