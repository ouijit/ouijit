import { BrowserWindow } from 'electron';
import { typedHandle, typedHandleWithWindow, typedOn } from '../helpers';
import {
  spawnPty,
  reconnectPty,
  getActiveSessions,
  setWindow,
  writeToPty,
  resizePty,
  killPty,
  setPtyLabel,
} from '../../ptyManager';
import * as limaPlugin from '../../lima';

export function registerPtyHandlers(mainWindow: BrowserWindow): void {
  typedHandleWithWindow('pty:spawn', async (window, options) => {
    const owner = window ?? mainWindow;
    if (options.sandboxed) {
      return await limaPlugin.spawnSandboxedPty(options, owner);
    }
    return await spawnPty(options, owner);
  });

  typedOn('pty:write', (ptyId, data) => {
    if (limaPlugin.isSandboxPty(ptyId)) {
      limaPlugin.writeSandboxPty(ptyId, data);
    } else {
      writeToPty(ptyId, data);
    }
  });

  typedOn('pty:resize', (ptyId, cols, rows) => {
    if (limaPlugin.isSandboxPty(ptyId)) {
      limaPlugin.resizeSandboxPty(ptyId, cols, rows);
    } else {
      resizePty(ptyId, cols, rows);
    }
  });

  typedOn('pty:kill', (ptyId) => {
    if (limaPlugin.isSandboxPty(ptyId)) {
      limaPlugin.killSandboxPty(ptyId);
    } else {
      killPty(ptyId);
    }
  });

  typedHandle('pty:get-active-sessions', () => [...getActiveSessions(), ...limaPlugin.getActiveSandboxSessions()]);
  typedHandleWithWindow('pty:reconnect', (window, ptyId) => {
    const owner = window ?? mainWindow;
    if (limaPlugin.isSandboxPty(ptyId)) {
      return limaPlugin.reconnectSandboxPty(ptyId, owner);
    }
    return reconnectPty(ptyId, owner);
  });

  typedOn('pty:set-label', (ptyId, label) => {
    if (limaPlugin.isSandboxPty(ptyId)) {
      limaPlugin.setSandboxPtyLabel(ptyId, label);
    } else {
      setPtyLabel(ptyId, label);
    }
  });

  typedOn('pty:set-window', () => {
    setWindow(mainWindow);
  });
}
