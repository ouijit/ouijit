/**
 * Renderer for the standalone terminal window — a "regular" terminal detached
 * from the main app window (opened via the global hotkey, dock menu, or
 * status-bar item). It hosts home-directory shells with none of the
 * project/kanban chrome. Mounted by renderer.tsx when the window is loaded with
 * `?mode=standalone`.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTerminalStore } from '../stores/terminalStore';
import { terminalInstances, hydrateTerminalFont } from './terminal/terminalReact';
import { addProjectTerminal, closeProjectTerminal, reconnectTerminal } from './terminal/terminalActions';
import { TerminalCardStack } from './terminal/TerminalCardStack';
import { XTermContainer } from './terminal/XTermContainer';
import { ToastContainer } from './ui/ToastContainer';
import { hydrateNotificationSettings } from '../utils/notifications';
import type { ActiveSession } from '../types';

const isMac = navigator.platform.toLowerCase().includes('mac');
const EMPTY: string[] = [];

/** Height of the draggable title strip; terminals start just below it. */
const TITLE_BAR_HEIGHT = 44;

export function StandaloneTerminalApp() {
  const [ready, setReady] = useState(false);

  // Hydrate the font cache before any terminal is constructed (terminals built
  // before this resolves fall back to the defaults).
  useEffect(() => {
    hydrateTerminalFont().finally(() => setReady(true));
    void hydrateNotificationSettings();
  }, []);

  // Prevent Electron drag/drop navigation (matches the main App).
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  if (!ready) return <div className="h-screen w-screen" style={{ background: 'var(--color-terminal-bg, #171717)' }} />;

  return (
    <div className="h-screen w-screen overflow-hidden" style={{ background: 'var(--color-terminal-bg, #171717)' }}>
      <StandaloneTitleBar />
      <StandaloneTerminalView />
      <ToastContainer />
    </div>
  );
}

function StandaloneTitleBar() {
  // An empty draggable strip so the frameless window can be moved; no label.
  return (
    <div
      className="absolute top-0 left-0 right-0 select-none z-10"
      style={{ height: TITLE_BAR_HEIGHT, WebkitAppRegion: 'drag' } as CSSProperties}
    />
  );
}

function StandaloneTerminalView() {
  const [homePath, setHomePath] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const initRef = useRef(false);
  const spawningRef = useRef(false);

  const terminals = useTerminalStore((s) => (homePath ? s.terminalsByProject[homePath] : undefined)) ?? EMPTY;

  useEffect(() => {
    window.api.homePath().then(setHomePath);
  }, []);

  // First mount: reconnect this window's standalone shells (they survive in the
  // main process across a renderer reload), or spawn a fresh one if there are
  // none. Standalone shells are tagged so the main app window doesn't reclaim
  // them and vice versa.
  useEffect(() => {
    if (!homePath || initRef.current) return;
    initRef.current = true;
    void (async () => {
      let sessions: ActiveSession[] = [];
      try {
        sessions = await window.api.pty.getActiveSessions();
      } catch {
        /* main process unavailable — fall through to a fresh spawn */
      }
      const mine = sessions.filter((s) => s.standalone && !s.isRunner);
      if (mine.length > 0) {
        for (const session of mine) {
          if (terminalInstances.has(session.ptyId)) continue;
          await reconnectTerminal(session);
        }
      } else {
        await addProjectTerminal(homePath, undefined, { standalone: true });
      }
      setInitialized(true);
    })();
  }, [homePath]);

  // Invariant: this window always has at least one terminal. If the count ever
  // drops to zero after init (e.g. the active card's close button), respawn a
  // fresh shell so the window is never empty.
  useEffect(() => {
    if (!homePath || !initialized || spawningRef.current) return;
    if (terminals.length === 0) {
      spawningRef.current = true;
      void addProjectTerminal(homePath, undefined, { standalone: true }).finally(() => {
        spawningRef.current = false;
      });
    }
  }, [homePath, initialized, terminals.length]);

  // Keyboard shortcuts mirror the home view: new tab, close tab, switch tab.
  useEffect(() => {
    if (!homePath) return;
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const store = useTerminalStore.getState();
      const ptyIds = store.terminalsByProject[homePath] ?? [];

      if (key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        void addProjectTerminal(homePath, undefined, { standalone: true });
        return;
      }

      if (key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        // Never close the last terminal — this mode keeps at least one open.
        if (ptyIds.length <= 1) return;
        const idx = store.activeIndices[homePath] ?? 0;
        const active = ptyIds[idx];
        if (active) closeProjectTerminal(active);
        return;
      }

      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        e.stopPropagation();
        if (num <= ptyIds.length) store.setActiveIndex(homePath, num - 1);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [homePath]);

  if (!homePath) return null;
  // A blank filler covers the transient gap before the first shell mounts or
  // while a respawn is in flight; the invariant effect above keeps it brief.
  if (terminals.length === 0) return <div className="absolute inset-0" />;
  // A single terminal fills the whole window to maximize screen real estate;
  // the inset card stack only appears once a second terminal is added.
  if (terminals.length === 1) {
    return (
      <div className="absolute left-0 right-0 bottom-0" style={{ top: TITLE_BAR_HEIGHT }}>
        <XTermContainer
          ptyId={terminals[0]}
          className="absolute inset-0 overflow-hidden pt-3 pl-4 pr-2 pb-2"
          style={{ background: 'var(--color-terminal-bg, #171717)' }}
        />
      </div>
    );
  }
  return <TerminalCardStack projectPath={homePath} />;
}
