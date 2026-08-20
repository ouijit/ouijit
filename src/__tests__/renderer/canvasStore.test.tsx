import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useCanvasStore,
  persistCanvas,
  loadPersistedCanvas,
  canvasNodeBase,
  type CanvasNode,
} from '../../stores/canvasStore';
import { syncCanvasWithTerminals } from '../../stores/canvasSync';
import { useTerminalStore } from '../../stores/terminalStore';

const PROJECT = '/project';

function canvas() {
  const state = useCanvasStore.getState().canvasByProject[PROJECT];
  if (!state) throw new Error('project not in canvas store');
  return state;
}

function nodeFor(ptyId: string): CanvasNode {
  const node = canvas().nodes.find((n) => n.data.ptyId === ptyId);
  if (!node) throw new Error(`no node for ${ptyId}`);
  return node;
}

/** Place nodes at known positions and sizes without going through a drag. */
function place(positions: Record<string, { x: number; y: number; width?: number; height?: number }>) {
  useCanvasStore.getState().setNodes(
    PROJECT,
    canvas().nodes.map((n) => {
      const at = positions[n.data.ptyId];
      if (!at) return n;
      return { ...n, position: { x: at.x, y: at.y }, width: at.width ?? 100, height: at.height ?? 100 };
    }),
  );
}

function select(...ptyIds: string[]) {
  const wanted = new Set(ptyIds);
  useCanvasStore.getState().setNodes(
    PROJECT,
    canvas().nodes.map((n) => ({ ...n, selected: wanted.has(n.data.ptyId) })),
  );
}

function addTerminal(ptyId: string, taskId: number | null, extra: { isLoading?: boolean; label?: string } = {}) {
  useTerminalStore.getState().addTerminal(PROJECT, ptyId, { taskId, label: extra.label ?? '', ...extra });
}

beforeEach(() => {
  vi.useFakeTimers();
  useCanvasStore.setState({ canvasByProject: {} });
  useTerminalStore.setState({ displayStates: {}, terminalsByProject: {}, activeIndices: {} });
  vi.mocked(window.api.globalSettings.set).mockClear();
  vi.mocked(window.api.globalSettings.get).mockResolvedValue(undefined);
  useCanvasStore.getState().ensureProject(PROJECT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('canvas node identity', () => {
  test('a task keeps its arrangement across a relaunch that renames every PTY', async () => {
    addTerminal('pty-a', 7);
    addTerminal('pty-b', 7);
    addTerminal('pty-c', null);
    syncCanvasWithTerminals(PROJECT);

    place({
      'pty-a': { x: 10, y: 20, width: 800, height: 600 },
      'pty-b': { x: 900, y: 20 },
      'pty-c': { x: 10, y: 700 },
    });
    persistCanvas(PROJECT);
    await vi.advanceTimersByTimeAsync(400);

    const written = vi.mocked(window.api.globalSettings.set).mock.calls.at(-1);
    expect(written?.[0]).toBe('canvas:/project');

    // Relaunch: stores are empty, the same sessions come back on new PTY ids.
    useCanvasStore.setState({ canvasByProject: {} });
    useTerminalStore.setState({ displayStates: {}, terminalsByProject: {}, activeIndices: {} });
    useCanvasStore.getState().ensureProject(PROJECT);
    vi.mocked(window.api.globalSettings.get).mockResolvedValue(written![1]);

    const saved = await loadPersistedCanvas(PROJECT);
    expect(saved).not.toBeNull();
    useCanvasStore.getState().loadCanvas(PROJECT, saved!);

    addTerminal('pty-x', 7);
    addTerminal('pty-y', 7);
    addTerminal('pty-z', null);
    syncCanvasWithTerminals(PROJECT);

    expect(nodeFor('pty-x').position).toEqual({ x: 10, y: 20 });
    expect(nodeFor('pty-x')).toMatchObject({ width: 800, height: 600 });
    expect(nodeFor('pty-y').position).toEqual({ x: 900, y: 20 });
    expect(nodeFor('pty-z').position).toEqual({ x: 10, y: 700 });
  });

  test('ids are the task plus an ordinal, and a reopened terminal reclaims the slot', () => {
    addTerminal('pty-a', 7);
    addTerminal('pty-b', 7);
    syncCanvasWithTerminals(PROJECT);

    expect(canvas().nodes.map((n) => n.id)).toEqual([`${canvasNodeBase(7)}#0`, `${canvasNodeBase(7)}#1`]);

    place({ 'pty-a': { x: 10, y: 20 }, 'pty-b': { x: 900, y: 20 } });
    useTerminalStore.getState().removeTerminal('pty-a');
    syncCanvasWithTerminals(PROJECT);
    expect(canvas().nodes.map((n) => n.id)).toEqual([`${canvasNodeBase(7)}#1`]);

    addTerminal('pty-again', 7);
    syncCanvasWithTerminals(PROJECT);
    expect(nodeFor('pty-again').id).toBe(`${canvasNodeBase(7)}#0`);
    expect(nodeFor('pty-again').position).toEqual({ x: 10, y: 20 });
  });
});

describe('syncCanvasWithTerminals', () => {
  test('rekeying a loading slot keeps its node, so the real PTY lands where the slot was', () => {
    addTerminal('slot-1', 4, { isLoading: true });
    syncCanvasWithTerminals(PROJECT);
    place({ 'slot-1': { x: 300, y: 120 } });

    useCanvasStore.getState().rekeyNode(PROJECT, 'slot-1', 'pty-real');

    expect(nodeFor('pty-real')).toMatchObject({
      id: `${canvasNodeBase(4)}#0`,
      position: { x: 300, y: 120 },
    });
    expect(canvas().nodes).toHaveLength(1);
  });

  test('prunes nodes with no terminal and leaves groups alone', () => {
    addTerminal('pty-a', 1);
    addTerminal('pty-b', 2);
    syncCanvasWithTerminals(PROJECT);
    select('pty-a', 'pty-b');
    useCanvasStore.getState().groupSelected(PROJECT);

    const groupId = canvas().nodes.find((n) => n.type === 'group')!.id;
    useTerminalStore.getState().removeTerminal('pty-b');
    syncCanvasWithTerminals(PROJECT);

    expect(canvas().nodes.map((n) => n.id)).toEqual([groupId, `${canvasNodeBase(1)}#0`]);
  });

  test('drops a group once its last child goes', () => {
    addTerminal('pty-a', 1);
    addTerminal('pty-b', 2);
    syncCanvasWithTerminals(PROJECT);
    select('pty-a', 'pty-b');
    useCanvasStore.getState().groupSelected(PROJECT);

    useTerminalStore.getState().removeTerminal('pty-a');
    useTerminalStore.getState().removeTerminal('pty-b');
    syncCanvasWithTerminals(PROJECT);

    expect(canvas().nodes).toEqual([]);
  });
});

describe('group and ungroup', () => {
  test('grouping reparents to relative positions and ungrouping restores absolutes', () => {
    addTerminal('pty-a', 1);
    addTerminal('pty-b', 2);
    addTerminal('pty-c', 3);
    syncCanvasWithTerminals(PROJECT);
    place({
      'pty-a': { x: 100, y: 100, width: 200, height: 200 },
      'pty-b': { x: 400, y: 500, width: 200, height: 200 },
      'pty-c': { x: 1000, y: 1000, width: 200, height: 200 },
    });

    select('pty-a', 'pty-b');
    useCanvasStore.getState().groupSelected(PROJECT);

    const group = canvas().nodes.find((n) => n.type === 'group')!;
    expect(group.position).toEqual({ x: 80, y: 80 });
    expect(group).toMatchObject({ width: 540, height: 640 });
    expect(nodeFor('pty-a').parentId).toBe(group.id);
    expect(nodeFor('pty-a').position).toEqual({ x: 20, y: 20 });
    expect(nodeFor('pty-b').position).toEqual({ x: 320, y: 420 });
    // A node outside the selection is untouched.
    expect(nodeFor('pty-c').parentId).toBeUndefined();
    expect(nodeFor('pty-c').position).toEqual({ x: 1000, y: 1000 });

    select('pty-a');
    useCanvasStore.getState().ungroupSelected(PROJECT);

    expect(canvas().nodes.some((n) => n.type === 'group')).toBe(false);
    expect(nodeFor('pty-a').parentId).toBeUndefined();
    expect(nodeFor('pty-a').position).toEqual({ x: 100, y: 100 });
    expect(nodeFor('pty-b').position).toEqual({ x: 400, y: 500 });
  });

  test('a single selected node is not a group', () => {
    addTerminal('pty-a', 1);
    syncCanvasWithTerminals(PROJECT);
    select('pty-a');
    useCanvasStore.getState().groupSelected(PROJECT);
    expect(canvas().nodes.some((n) => n.type === 'group')).toBe(false);
  });
});

describe('align and distribute', () => {
  beforeEach(() => {
    addTerminal('pty-a', 1);
    addTerminal('pty-b', 2);
    addTerminal('pty-c', 3);
    syncCanvasWithTerminals(PROJECT);
    place({
      'pty-a': { x: 0, y: 0, width: 100, height: 100 },
      'pty-b': { x: 200, y: 50, width: 200, height: 200 },
      'pty-c': { x: 500, y: 400, width: 100, height: 100 },
    });
    select('pty-a', 'pty-b', 'pty-c');
  });

  test('aligns to each edge and to the centre of the selection', () => {
    useCanvasStore.getState().alignSelected(PROJECT, 'left');
    expect(canvas().nodes.map((n) => n.position.x)).toEqual([0, 0, 0]);

    place({
      'pty-a': { x: 0, y: 0, width: 100, height: 100 },
      'pty-b': { x: 200, y: 50, width: 200, height: 200 },
      'pty-c': { x: 500, y: 400, width: 100, height: 100 },
    });
    useCanvasStore.getState().alignSelected(PROJECT, 'right');
    // Right edge of the selection is pty-c's, at 600.
    expect(canvas().nodes.map((n) => n.position.x + n.width!)).toEqual([600, 600, 600]);

    useCanvasStore.getState().alignSelected(PROJECT, 'bottom');
    expect(canvas().nodes.map((n) => n.position.y + n.height!)).toEqual([500, 500, 500]);

    useCanvasStore.getState().alignSelected(PROJECT, 'center-v');
    const centres = canvas().nodes.map((n) => n.position.y + n.height! / 2);
    expect(new Set(centres).size).toBe(1);
  });

  test('leaves unselected nodes where they are', () => {
    select('pty-a', 'pty-b');
    useCanvasStore.getState().alignSelected(PROJECT, 'left');
    expect(nodeFor('pty-c').position).toEqual({ x: 500, y: 400 });
  });

  test('distributes with equal gaps between the outermost nodes', () => {
    useCanvasStore.getState().distributeSelected(PROJECT, 'horizontal');

    const [a, b, c] = ['pty-a', 'pty-b', 'pty-c'].map(nodeFor);
    expect(a.position.x).toBe(0);
    expect(c.position.x + 100).toBe(600);
    const firstGap = b.position.x - (a.position.x + 100);
    const secondGap = c.position.x - (b.position.x + 200);
    expect(firstGap).toBeCloseTo(secondGap);
    expect(firstGap).toBeCloseTo(100);
  });

  test('distribute needs three nodes', () => {
    select('pty-a', 'pty-b');
    useCanvasStore.getState().distributeSelected(PROJECT, 'horizontal');
    expect(nodeFor('pty-b').position.x).toBe(200);
  });
});
