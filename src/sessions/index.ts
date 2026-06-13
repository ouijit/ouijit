/**
 * Main-process wiring for the durable session manager (task #462).
 *
 * Owns the process-wide {@link SessionManager} singleton: constructs it with the
 * SQLite-backed store, the node-pty backend, and an emitter that pushes the
 * {@link SessionEvent} stream to the renderer, then rehydrates dormant sessions
 * from the last run. The renderer-facing API (#461) and projection (#463) reach
 * the manager through the session IPC handlers, never through this module
 * directly.
 */
import type { BrowserWindow } from 'electron';
import { typedPush } from '../ipc/helpers';
import { getDatabase } from '../db/database';
import { SessionRepo } from '../db/repos/sessionRepo';
import { getLogger } from '../logger';
import { SessionManager } from './manager';
import { NodePtyBackend } from './nodePtyBackend';

const sessionLog = getLogger().scope('sessions');

let manager: SessionManager | null = null;

/**
 * Initialize the session manager singleton and rehydrate dormant sessions from
 * the store. Idempotent — returns the existing manager if already initialized.
 */
export function initSessionManager(getWindow: () => BrowserWindow | null): SessionManager {
  if (manager) return manager;

  manager = new SessionManager({
    store: new SessionRepo(getDatabase()),
    backend: new NodePtyBackend(),
    emit: (event) => {
      const window = getWindow();
      if (window) typedPush(window, 'session:event', event);
    },
  });

  try {
    manager.rehydrate();
  } catch (error) {
    sessionLog.error('rehydrate failed', { error: error instanceof Error ? error.message : String(error) });
  }

  return manager;
}

export function getSessionManager(): SessionManager | null {
  return manager;
}

/** Persist all sessions before the app tears their processes down at quit. */
export function shutdownSessionManager(): void {
  if (!manager) return;
  try {
    manager.persistAll();
  } catch (error) {
    sessionLog.error('persistAll failed during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  manager = null;
}

/** Test-only: drop the singleton so a fresh manager is built next init. */
export function _resetSessionManagerForTesting(): void {
  manager = null;
}
