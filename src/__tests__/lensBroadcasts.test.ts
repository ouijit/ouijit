import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { LensInput } from '../lens/config';

/**
 * A lens list changing is told, not reached for.
 *
 * Every picker and list holds its own copy of `lens:list`, and the pane a lens
 * was added in is rarely the only one open. Broadcast rather than patched in by
 * that pane, which would have to know every surface currently showing a lens —
 * a list that only grows.
 *
 * A rename is not a separate announcement: a lens is keyed by its id and its
 * name is looked up fresh, so re-reading the list is the whole of it.
 */

const typedHandlers = new Map<string, (...args: never[]) => unknown>();
const typedPushMock = vi.fn();

vi.mock('../ipc/helpers', () => ({
  typedHandle: (channel: string, handler: (...args: never[]) => unknown) => typedHandlers.set(channel, handler),
  typedPush: (...args: unknown[]) => typedPushMock(...args),
}));

const saveLensMock = vi.fn(async (_project: string, input: LensInput) => ({ id: input.id ?? 'made', ...input }));
vi.mock('../lens/config', () => ({
  listLenses: vi.fn(async () => []),
  saveLens: (...args: [string, LensInput]) => saveLensMock(...args),
  deleteLens: vi.fn(async () => ({ success: true })),
  getLensAgentChoice: vi.fn(async () => ({ agentId: null })),
  setLensAgentChoice: vi.fn(async () => ({ success: true })),
}));

vi.mock('../diffNotesService', () => ({
  listNotes: vi.fn(),
  saveNote: vi.fn(),
  discardNote: vi.fn(),
  clearNotes: vi.fn(),
}));

vi.mock('../lens/worktreeSubject', () => ({ readDiffLens: vi.fn(), writeDiffLens: vi.fn() }));

const { registerDiffPanelHandlers } = await import('../ipc/handlers/diffPanel');

const WINDOW = {} as BrowserWindow;
const PROJECT = '/work/alpha';

function remove(id: string): Promise<unknown> {
  const handler = typedHandlers.get('lens:delete') as (project: string, id: string) => Promise<unknown>;
  return handler(PROJECT, id);
}

function save(input: LensInput): Promise<unknown> {
  const handler = typedHandlers.get('lens:save') as (project: string, input: LensInput) => Promise<unknown>;
  return handler(PROJECT, input);
}

describe('what a lens change tells the renderer', () => {
  beforeEach(() => {
    typedHandlers.clear();
    typedPushMock.mockClear();
    registerDiffPanelHandlers(WINDOW);
  });

  test('the list is broadcast whichever way it changed', async () => {
    await save({ name: 'Narrative', instruction: 'group by story' });
    await save({ id: 'made', name: 'Narrative v2', instruction: 'group by story' });
    await remove('made');

    // A delete would otherwise say nothing at all, which is how a picker ends
    // up offering a lens the project has dropped.
    expect(typedPushMock.mock.calls).toEqual([
      [WINDOW, 'lens:list-changed', PROJECT],
      [WINDOW, 'lens:list-changed', PROJECT],
      [WINDOW, 'lens:list-changed', PROJECT],
    ]);
  });
});
