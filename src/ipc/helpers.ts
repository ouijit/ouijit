/**
 * Type-safe IPC registration helpers.
 *
 * These wrappers ensure that handler functions receive only business args
 * (IpcMainInvokeEvent is stripped) and that their signatures match the contract.
 */

import { ipcMain } from 'electron';
import type { IpcInvokeContract, IpcSendContract } from './contract';

/**
 * Register a type-safe ipcMain.handle() handler.
 * The handler receives only the business args (event is stripped).
 */
export function typedHandle<C extends keyof IpcInvokeContract>(
  channel: C,
  handler: (...args: IpcInvokeContract[C]['args']) => Promise<IpcInvokeContract[C]['return']> | IpcInvokeContract[C]['return']
): void {
  ipcMain.handle(channel, (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) =>
    (handler as (...a: unknown[]) => unknown)(...args),
  );
}

/**
 * Register a type-safe ipcMain.on() handler (fire-and-forget, no response).
 * The handler receives only the business args (event is stripped).
 */
export function typedOn<C extends keyof IpcSendContract>(
  channel: C,
  handler: (...args: IpcSendContract[C]['args']) => void
): void {
  ipcMain.on(channel, (_event: Electron.IpcMainEvent, ...args: unknown[]) => {
    (handler as (...a: unknown[]) => void)(...args);
  });
}
