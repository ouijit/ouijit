import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindow } from 'electron';

/**
 * A lens changing is told, not reached for.
 *
 * Two different things get told. `lens:list-changed` says the project has one
 * more or one fewer, which every picker and list holds its own copy of.
 * `lens:renamed` says a lens still there is now called something else, which
 * only matters to whatever is showing a grouping it wrote — and the rename
 * happens in one call, list and groupings together, so that is a single local
 * row out of date rather than anything to go and fix.
 *
 * Both are broadcast rather than patched in by the pane the change was typed
 * into, which would have to know every surface currently showing a lens — a
 * list that only grows.
 */

const typedHandlers = new Map<string, (...args: never[]) => unknown>();
const typedPushMock = vi.fn();

vi.mock('../ipc/helpers', () => ({
  typedHandle: (channel: string, handler: (...args: never[]) => unknown) => typedHandlers.set(channel, handler),
  typedPush: (...args: unknown[]) => typedPushMock(...args),
}));

const saveLensMock = vi.fn(async (_project: string, name: string, instruction: string) => ({ name, instruction }));
vi.mock('../lens/config', () => ({
  listLenses: vi.fn(async () => []),
  saveLens: (...args: [string, string, string, string | undefined]) => saveLensMock(...args),
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

function remove(name: string): Promise<unknown> {
  const handler = typedHandlers.get('lens:delete') as (project: string, name: string) => Promise<unknown>;
  return handler(PROJECT, name);
}

function save(name: string, previousName?: string): Promise<unknown> {
  const handler = typedHandlers.get('lens:save') as (
    project: string,
    name: string,
    instruction: string,
    previousName?: string,
  ) => Promise<unknown>;
  return handler(PROJECT, name, 'group by story', previousName);
}

describe('what a lens change tells the renderer', () => {
  beforeEach(() => {
    typedHandlers.clear();
    typedPushMock.mockClear();
    registerDiffPanelHandlers(WINDOW);
  });

  test('says so, naming both the old name and the new', async () => {
    await save('Narrative v2', 'Narrative');

    expect(typedPushMock).toHaveBeenCalledWith(WINDOW, 'lens:renamed', {
      projectPath: PROJECT,
      from: 'Narrative',
      to: 'Narrative v2',
    });
  });

  test('a new lens is not a rename, and neither is an edit that keeps its name', async () => {
    await save('Narrative');
    await save('Narrative', 'Narrative');

    // No grouping can be reading through a name that has not moved, so there
    // is nothing for the rename channel to say.
    const renames = typedPushMock.mock.calls.filter(([, channel]) => channel === 'lens:renamed');
    expect(renames).toEqual([]);
  });

  test('the list is broadcast whichever way it changed', async () => {
    await save('Narrative');
    await save('Narrative v2', 'Narrative');
    await remove('Narrative v2');

    // A delete has no rename to report and would otherwise say nothing at all,
    // which is how a picker ends up offering a lens the project has dropped.
    expect(typedPushMock.mock.calls.filter(([, channel]) => channel === 'lens:list-changed')).toEqual([
      [WINDOW, 'lens:list-changed', PROJECT],
      [WINDOW, 'lens:list-changed', PROJECT],
      [WINDOW, 'lens:list-changed', PROJECT],
    ]);
  });
});
