import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';

/**
 * Registers global IPC push event listeners.
 * Call once in App.tsx. Handles cleanup on unmount.
 *
 * Per-terminal listeners (pty:data, pty:exit) remain in OuijitTerminal.bind()
 * and are NOT registered here — they are imperative, not React-managed.
 *
 * Claude hook status listener is registered in useHookStatusListener()
 * to avoid pulling in terminal module at top-level.
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

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
}
