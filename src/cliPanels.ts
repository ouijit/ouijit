/**
 * CLI ↔ renderer panel bridge.
 *
 * The CLI's `markdown` and `preview` commands operate on a terminal's live
 * panels, which are owned by the renderer (`terminalInstances`). The main
 * process can't read or mutate them directly, so this module forwards each op
 * to the renderer over a `cli:panel-op` push and awaits the matching
 * `cli-panels:respond` reply, correlated by an incrementing request id. The
 * renderer answers from a listener installed for the life of the window, so a
 * timeout here means the window itself is not answering.
 *
 * These ops are the only way a panel appears without a click, and they always
 * reflect what's on screen. `ouijit tag`, `terminal` and `point` cross the same
 * bridge on channels of their own, since tags, the xterm buffer and pointers
 * live there too.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { typedPush } from './ipc/helpers';
import { getLogger } from './logger';
import {
  TERMINAL_READY_WAIT_MS,
  type CliPanelOp,
  type CliPanelResponse,
  type CliTagOp,
  type CliTagResponse,
  type CliTerminalOp,
  type CliTerminalResponse,
  type CliPointOp,
  type CliPointResponse,
} from './types';

const cliPanelsLog = getLogger().scope('cliPanels');

/** How long to wait for the renderer's reply before giving up. */
const REQUEST_TIMEOUT_MS = TERMINAL_READY_WAIT_MS + 2000;

let mainWindow: BrowserWindow | null = null;
let nextRequestId = 1;

interface Pending {
  resolve: (response: never) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, Pending>();

function settle(
  requestId: number,
  response: CliPanelResponse | CliTagResponse | CliTerminalResponse | CliPointResponse,
): void {
  const entry = pending.get(requestId);
  if (!entry) return; // late or duplicate reply — request already settled
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(response as never);
}

export function initCliPanels(window: BrowserWindow): void {
  mainWindow = window;
  ipcMain.handle('cli-panels:respond', (_event, requestId: number, response: CliPanelResponse) =>
    settle(requestId, response),
  );
  ipcMain.handle('cli-tags:respond', (_event, requestId: number, response: CliTagResponse) =>
    settle(requestId, response),
  );
  ipcMain.handle('cli-terminals:respond', (_event, requestId: number, response: CliTerminalResponse) =>
    settle(requestId, response),
  );
  ipcMain.handle('cli-points:respond', (_event, requestId: number, response: CliPointResponse) =>
    settle(requestId, response),
  );
}

/**
 * Push an op to the renderer and resolve with its reply. Resolves with
 * `{ ok: false }` (never rejects) when the renderer is gone or doesn't answer,
 * so callers translate a single failure shape into an HTTP error.
 */
function request<R extends { ok: boolean; error?: string }>(
  push: (window: BrowserWindow, requestId: number) => void,
  logContext: Record<string, unknown>,
): Promise<R> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ ok: false, error: 'Ouijit window is not available' } as R);
  }

  const requestId = nextRequestId++;
  return new Promise<R>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      cliPanelsLog.warn('cli op timed out', { requestId, ...logContext });
      resolve({ ok: false, error: 'Ouijit window did not respond — try again in a moment' } as R);
    }, REQUEST_TIMEOUT_MS);

    pending.set(requestId, { resolve, timer });
    push(mainWindow as BrowserWindow, requestId);
  });
}

export function cliPanelRequest(op: Omit<CliPanelOp, 'requestId'>): Promise<CliPanelResponse> {
  return request((window, requestId) => typedPush(window, 'cli:panel-op', { requestId, ...op }), {
    ptyId: op.ptyId,
    action: op.action,
    kind: op.kind,
  });
}

export function cliTerminalRequest(op: Omit<CliTerminalOp, 'requestId'>): Promise<CliTerminalResponse> {
  return request((window, requestId) => typedPush(window, 'cli:terminal-op', { requestId, ...op }), {
    ptyId: op.ptyId,
    action: op.action,
  });
}

export function cliPointRequest(op: Omit<CliPointOp, 'requestId'>): Promise<CliPointResponse> {
  return request((window, requestId) => typedPush(window, 'cli:point-op', { requestId, ...op }), {
    fromPtyId: op.fromPtyId,
    action: op.action,
  });
}

export function cliTagRequest(op: Omit<CliTagOp, 'requestId'>): Promise<CliTagResponse> {
  return request((window, requestId) => typedPush(window, 'cli:tag-op', { requestId, ...op }), {
    ptyId: op.ptyId,
    action: op.action,
  });
}
