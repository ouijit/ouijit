/**
 * A lens list changing is told, not reached for: every picker holds its own copy
 * of `lens:list`, and a rename is not a separate announcement because a lens is
 * keyed by id and its name looked up fresh.
 *
 * Electron is the only thing stubbed. The handlers, the helpers that register
 * them and the store they write to are real, so what this pins is that a lens is
 * saved and the renderer told — not that two fakes were called.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { _resetCacheForTesting } from '../../db';
import { registerDiffPanelHandlers } from '../../ipc/handlers/diffPanel';
import type { LensInput, LensSummary } from '../../lens/config';

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = vi.hoisted(() => new Map<string, IpcHandler>());

// The setup file mocks this for `app` alone; registering a handler needs
// `ipcMain` as well, and this is where they are collected from.
vi.mock('electron', async () => {
  const { getUserDataPath } = await import('../../paths');
  return {
    app: { getPath: () => getUserDataPath() },
    ipcMain: { handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler) },
  };
});

const PROJECT = '/work/alpha';

const sent: Array<[string, unknown[]]> = [];
/** What `typedPush` asks of a window, and no more. */
const window = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, ...args: unknown[]) => sent.push([channel, args]) },
};

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return Promise.resolve(handler(null, ...args) as T);
}

describe('what a lens change tells the renderer', () => {
  beforeEach(() => {
    _resetCacheForTesting();
    handlers.clear();
    sent.length = 0;
    registerDiffPanelHandlers(window as unknown as BrowserWindow);
  });

  test('the list is broadcast whichever way it changed, and says which project', async () => {
    const made = await call<LensSummary>('lens:save', PROJECT, {
      name: 'Narrative',
      instruction: 'group by story',
    } satisfies LensInput);
    await call('lens:save', PROJECT, { id: made.id, name: 'Narrative v2', instruction: 'group by story' });
    expect((await call<LensSummary[]>('lens:list', PROJECT)).map((lens) => lens.name)).toEqual(['Narrative v2']);

    await call('lens:delete', PROJECT, made.id);
    // A delete would otherwise say nothing at all, which is how a picker ends
    // up offering a lens the project has dropped.
    expect(await call<LensSummary[]>('lens:list', PROJECT)).toEqual([]);

    expect(sent).toEqual([
      ['lens:list-changed', [PROJECT]],
      ['lens:list-changed', [PROJECT]],
      ['lens:list-changed', [PROJECT]],
    ]);
  });
});
