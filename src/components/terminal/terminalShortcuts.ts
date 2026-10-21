import { useEffect, useRef } from 'react';
import { getActivePtyId, activateTerminal } from '../../stores/terminalStore';
import { getProjectConfig } from '../../stores/projectDataStore';
import { isActiveSandbox } from '../../types';
import { terminalInstances } from './terminalRegistry';
import { closeProjectTerminal, startRunner } from './terminalActions';
import { openShell } from '../navigation';
import { refreshTerminalsGitStatus } from './terminalReact';
import { getStackPositions } from './stackPositions';

const isMac = navigator.platform.toLowerCase().includes('mac');
const GIT_REFRESH_INTERVAL = 30000;

/** Returns false to let the key through. */
export type ViewKeyHandler = (e: KeyboardEvent) => boolean | void;

/** What the terminal shortcuts act on in the view on screen. */
export interface TerminalView {
  stack: string;
  shellPath: () => string | Promise<string>;
  /** The terminal ⌘W, ⌘P and ⌘D act on, when it isn't the stack's active one. */
  activeTerminal?: () => string | undefined;
  /** How ⌘1–9 bring a terminal forward, when it isn't by activating it. */
  select?: (ptyId: string) => void;
  /** The terminals whose git status is worth keeping current. */
  onScreen: () => string[];
}

let currentView: { current: TerminalView } | null = null;
const viewKeys = new Set<{ current: Record<string, ViewKeyHandler> }>();

/** Registers the view on screen. One is mounted at a time. */
export function useTerminalView(view: TerminalView): void {
  const ref = useRef(view);
  ref.current = view;
  useEffect(() => {
    currentView = ref;
    return () => {
      if (currentView === ref) currentView = null;
    };
  }, []);
}

/** Keys a view binds for itself, by `KeyboardEvent.key` lowercased, all with ⌘ (Ctrl elsewhere). */
export function useViewKeys(keys: Record<string, ViewKeyHandler>): void {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    viewKeys.add(ref);
    return () => {
      viewKeys.delete(ref);
    };
  }, []);
}

function runViewKey(key: string, e: KeyboardEvent): boolean {
  for (const keys of [...viewKeys].reverse()) {
    const handler = keys.current[key];
    if (handler && handler(e) !== false) return true;
  }
  return false;
}

function toggleRunner(ptyId: string): void {
  const instance = terminalInstances.get(ptyId);
  if (!instance) return;
  const runner = instance.panels.find((p) => p.kind === 'runner');
  if (runner) {
    instance.activatePanel(runner.id);
    return;
  }
  const sandbox = getProjectConfig(instance.projectPath)?.defaultSandbox;
  void startRunner(ptyId, undefined, isActiveSandbox(sandbox) ? sandbox : undefined);
}

function handleTerminalKey(view: TerminalView, key: string): boolean {
  const active = view.activeTerminal ? view.activeTerminal() : getActivePtyId(view.stack);
  switch (key) {
    case 'i':
      void Promise.resolve(view.shellPath()).then(openShell);
      return true;
    case 'w':
      if (active) closeProjectTerminal(active);
      return true;
    case 'p':
      if (active) toggleRunner(active);
      return true;
    case 'd':
      if (active) terminalInstances.get(active)?.toggleDiffPanel();
      return true;
  }
  const position = parseInt(key, 10);
  if (position >= 1 && position <= 9) {
    const target = getStackPositions()[position - 1];
    if (target) (view.select ?? activateTerminal)(target);
    return true;
  }
  return false;
}

/** The one keydown handler for terminal shortcuts, and the git status upkeep for what is on screen. */
export function useTerminalShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!(isMac ? e.metaKey : e.ctrlKey)) return;
      const view = currentView?.current;
      if (!view) return;
      const key = e.key.toLowerCase();
      if (runViewKey(key, e) || handleTerminalKey(view, key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval != null || document.hidden) return;
      interval = setInterval(() => {
        if (currentView) void refreshTerminalsGitStatus(currentView.current.onScreen());
      }, GIT_REFRESH_INTERVAL);
    };
    const stop = () => {
      if (interval != null) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []);
}
