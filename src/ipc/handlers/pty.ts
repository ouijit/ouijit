import { BrowserWindow } from 'electron';
import { typedHandle, typedOn } from '../helpers';
import {
  spawnPty,
  reconnectPty,
  getActiveSessions,
  setWindow,
  writeToPty,
  resizePty,
  killPty,
} from '../../ptyManager';
import * as limaPlugin from '../../lima';
import { getHook } from '../../projectSettings';

export function registerPtyHandlers(mainWindow: BrowserWindow): void {
  typedHandle('pty:spawn', async (options) => {
    if (options.sandboxed) {
      const hook = await getHook(options.projectPath || options.cwd, 'sandbox-setup');
      return await limaPlugin.spawnSandboxedPty(options, mainWindow, hook?.command);
    }
    return await spawnPty(options, mainWindow);
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

  typedHandle('pty:get-active-sessions', () => getActiveSessions());
  typedHandle('pty:reconnect', (ptyId) => reconnectPty(ptyId, mainWindow));

  typedOn('pty:set-window', () => {
    setWindow(mainWindow);
  });
}
