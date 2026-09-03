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
  setPtyLabel,
} from '../../ptyManager';
import { getSandboxProvider, listSessionOwners, findSessionOwner } from '../../sandbox';

export function registerPtyHandlers(mainWindow: BrowserWindow): void {
  typedHandle('pty:spawn', async (options) => {
    // Resolve the task's sandbox backend. A session-owner (Lima) takes full
    // custody of the spawn; a wrapper flows through the host spawn path
    // with its launch transform applied. No provider → plain host shell.
    const provider = getSandboxProvider(options.sandboxProvider);
    if (!provider) {
      return await spawnPty(options, mainWindow);
    }
    if (provider.kind === 'session-owner') {
      return await provider.spawnPty(options, mainWindow);
    }
    return await spawnPty(options, mainWindow, provider);
  });

  typedOn('pty:write', (ptyId, data) => {
    const owner = findSessionOwner(ptyId);
    if (owner) owner.writePty(ptyId, data);
    else writeToPty(ptyId, data);
  });

  typedOn('pty:resize', (ptyId, cols, rows) => {
    const owner = findSessionOwner(ptyId);
    if (owner) owner.resizePty(ptyId, cols, rows);
    else resizePty(ptyId, cols, rows);
  });

  typedOn('pty:kill', (ptyId) => {
    const owner = findSessionOwner(ptyId);
    if (owner) owner.killPty(ptyId);
    else killPty(ptyId);
  });

  typedHandle('pty:get-active-sessions', () => [
    ...getActiveSessions(),
    ...listSessionOwners().flatMap((p) => p.getActiveSessions()),
  ]);
  typedHandle('pty:reconnect', (ptyId) => {
    const owner = findSessionOwner(ptyId);
    if (owner) return owner.reconnectPty(ptyId, mainWindow);
    return reconnectPty(ptyId, mainWindow);
  });

  typedOn('pty:set-label', (ptyId, label) => {
    const owner = findSessionOwner(ptyId);
    if (owner) owner.setPtyLabel(ptyId, label);
    else setPtyLabel(ptyId, label);
  });

  typedOn('pty:set-window', () => {
    setWindow(mainWindow);
  });
}
