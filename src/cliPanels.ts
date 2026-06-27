/**
 * CLI ↔ renderer panel bridge.
 *
 * The CLI's `markdown` and `preview` commands operate on a terminal's live
 * panels, which are owned by the renderer (`terminalInstances`). The main
 * process can't read or mutate them directly, so this module forwards each op
 * to the renderer over a `cli:panel-op` push and awaits the matching
 * `cli-panels:respond` reply, correlated by an incrementing request id.
 *
 * Kept separate from `hookServer`'s `planPathMap` on purpose: that map is the
 * single agent-detected plan per pty (ExitPlanMode flow). These ops are the
 * plural, user/CLI-addressable panel set and always reflect what's on screen.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { typedPush } from './ipc/helpers';
import { getLogger } from './logger';
import type { CliPanelOp, CliPanelResponse } from './types';

const cliPanelsLog = getLogger().scope('cliPanels');

/** How long to wait for the renderer's reply before giving up. */
const REQUEST_TIMEOUT_MS = 5000;

let mainWindow: BrowserWindow | null = null;
let nextRequestId = 1;

interface Pending {
  resolve: (response: CliPanelResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, Pending>();

/** Wire the bridge to the main window and register the renderer reply handler. */
export function initCliPanels(window: BrowserWindow): void {
  mainWindow = window;
  ipcMain.handle('cli-panels:respond', (_event, requestId: number, response: CliPanelResponse) => {
    const entry = pending.get(requestId);
    if (!entry) return; // late or duplicate reply — request already settled
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(response);
  });
}

/**
 * Forward a panel op to the renderer and resolve with its reply. Resolves with
 * `{ ok: false }` (never rejects) when the renderer is gone or doesn't answer,
 * so callers translate a single failure shape into an HTTP error.
 */
export function cliPanelRequest(op: Omit<CliPanelOp, 'requestId'>): Promise<CliPanelResponse> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ ok: false, error: 'Ouijit window is not available' });
  }

  const requestId = nextRequestId++;
  return new Promise<CliPanelResponse>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      cliPanelsLog.warn('panel op timed out', { requestId, ptyId: op.ptyId, action: op.action, kind: op.kind });
      resolve({ ok: false, error: 'Terminal did not respond (is the panel still open?)' });
    }, REQUEST_TIMEOUT_MS);

    pending.set(requestId, { resolve, timer });
    typedPush(mainWindow as BrowserWindow, 'cli:panel-op', { requestId, ...op });
  });
}
