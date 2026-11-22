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
import { resolveSandbox } from '../../sandbox/resolve';

export function registerPtyHandlers(mainWindow: BrowserWindow): void {
  typedHandle('pty:spawn', async ({ sandbox, ...options }) => {
    const spec = await resolveSandbox({
      projectPath: options.projectPath || options.cwd,
      placement: sandbox ?? 'none',
    });
    return await spawnPty(options, mainWindow, spec);
  });

  typedOn('pty:write', (ptyId, data) => writeToPty(ptyId, data));
  typedOn('pty:resize', (ptyId, cols, rows) => resizePty(ptyId, cols, rows));
  typedOn('pty:kill', (ptyId) => killPty(ptyId));
  typedHandle('pty:get-active-sessions', () => getActiveSessions());
  typedHandle('pty:reconnect', (ptyId) => reconnectPty(ptyId, mainWindow));
  typedOn('pty:set-label', (ptyId, label) => setPtyLabel(ptyId, label));

  typedOn('pty:set-window', () => {
    setWindow(mainWindow);
  });
}
