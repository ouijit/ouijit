import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';

/**
 * Registers global IPC push event listeners.
 * Call once in App.tsx. Handles cleanup on unmount.
 *
 * Per-terminal listeners (pty:data, pty:exit) remain in OuijitTerminal.bind()
 * and are NOT registered here — they are imperative, not React-managed.
 */
export function useIPCListeners() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    // Fullscreen state changes from main process
    cleanups.push(
      window.api.onFullscreenChange((isFullscreen) => {
        useAppStore.getState().setFullscreen(isFullscreen);
      }),
    );

    // Note: claude-hook-status and lima:spawn-progress listeners
    // will be wired to terminal instances in later phases.
    // For now, only the global fullscreen listener is needed.

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
}
