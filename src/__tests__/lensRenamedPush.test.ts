import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindow } from 'electron';

/**
 * Renaming a lens is told, not reached for.
 *
 * The rename happens in one call — the lens list and every grouping it wrote —
 * so whatever is showing one is a single local row out of date. Patching that
 * in from the settings panel instead would mean knowing every surface currently
 * displaying a lens, which is a list that only grows.
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

vi.mock('../diffLens', () => ({ readDiffLens: vi.fn(), writeDiffLens: vi.fn() }));

const { registerDiffPanelHandlers } = await import('../ipc/handlers/diffPanel');

const WINDOW = {} as BrowserWindow;
const PROJECT = '/work/alpha';

function save(name: string, previousName?: string): Promise<unknown> {
  const handler = typedHandlers.get('lens:save') as (
    project: string,
    name: string,
    instruction: string,
    previousName?: string,
  ) => Promise<unknown>;
  return handler(PROJECT, name, 'group by story', previousName);
}

describe('renaming a lens', () => {
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

  test('an edit that keeps the name says nothing — nothing is out of date', async () => {
    await save('Narrative', 'Narrative');

    expect(typedPushMock).not.toHaveBeenCalled();
  });

  test('a new lens says nothing either: no grouping can be reading through it yet', async () => {
    await save('Narrative');

    expect(typedPushMock).not.toHaveBeenCalled();
  });
});
