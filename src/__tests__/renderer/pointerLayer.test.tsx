import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PointerLayer } from '../../components/point/PointerLayer';
import { installCliPointListener } from '../../services/cliPointListener';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import { pointKey } from '../../components/point/pointKeys';
import { useAppStore } from '../../stores/appStore';
import { usePointerStore } from '../../stores/pointerStore';
import { DEFAULT_DISPLAY_STATE, useTerminalStore } from '../../stores/terminalStore';
import type { CliPointOp, CliPointResponse, TaskWithWorkspace } from '../../types';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// jsdom lays nothing out, so every element reads as 0×0. Each fixture says
// where it sits instead, `left,top,width,height`; one without a rect is unlaid.
const realRect = HTMLElement.prototype.getBoundingClientRect;
function layOut(): void {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const [left, top, width, height] = (this.dataset.rect ?? '0,0,0,0').split(',').map(Number);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} };
  };
}

const PROJECT = '/code/alpha';
const task = { taskNumber: 14, name: 'Rate limit login', status: 'in_progress', createdAt: '' } as TaskWithWorkspace;

function Screen({ board = true, rows = true }: { board?: boolean; rows?: boolean }) {
  return (
    <>
      <aside aria-label="Sidebar" data-rect="0,0,268,800">
        <div data-point-target={pointKey.project(PROJECT)} data-rect="10,50,248,30">
          alpha
        </div>
        {rows && (
          <div data-point-target={pointKey.task(PROJECT, 14)} data-rect="10,122,248,34">
            Rate limit login
          </div>
        )}
      </aside>
      <main data-rect="268,0,1012,800">
        {board && (
          <div data-point-target={pointKey.task(PROJECT, 14)} data-rect="534,172,230,64">
            card
          </div>
        )}
      </main>
    </>
  );
}

function ribbon(): HTMLElement {
  return screen.getByRole('button', { name: /^Follow / });
}

beforeEach(() => {
  layOut();
  usePointerStore.setState({ pointers: [] });
  useAppStore.setState({
    projects: [{ path: PROJECT, name: 'alpha' } as never],
    taskCacheByProject: { [PROJECT]: [task] },
    selection: { kind: 'none' },
  });
  useTerminalStore.setState({
    order: ['pty-agent', 'pty-other'],
    terminalsByProject: { [PROJECT]: ['pty-agent', 'pty-other'] },
    displayStates: {
      'pty-agent': { ...DEFAULT_DISPLAY_STATE, ptyId: 'pty-agent', projectPath: PROJECT, label: 'Fix auth timeout' },
      'pty-other': { ...DEFAULT_DISPLAY_STATE, ptyId: 'pty-other', projectPath: PROJECT, label: 'Docs nav' },
    },
  });
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

describe('a pointer on screen', () => {
  test('lands on the main area over the sidebar, stands in on what holds a hidden target until followed there, and counts pointers', async () => {
    const { rerender } = render(
      <>
        <Screen />
        <PointerLayer />
      </>,
    );
    act(() =>
      usePointerStore
        .getState()
        .point({ from: 'pty-agent', target: { kind: 'task', projectPath: PROJECT, taskNumber: 14 } }),
    );

    // The board card, not the sidebar row: its right edge, overlapping it a little.
    await waitFor(() => expect(ribbon().style.left).toBe('758px'));
    expect(ribbon().getAttribute('aria-label')).toBe('Follow Fix auth timeout, which points here');

    // With the board gone and the project folded, the project's header stands in, naming what is really meant.
    rerender(
      <>
        <Screen board={false} rows={false} />
        <PointerLayer />
      </>,
    );
    await waitFor(() =>
      expect(ribbon().getAttribute('aria-label')).toBe('Follow Fix auth timeout, which points to Rate limit login'),
    );
    expect(ribbon().style.top).toBe(`${50 + 15 - 12}px`);

    // A second agent at the same thing: one ribbon, counting both, each listed on hover.
    act(() =>
      usePointerStore.getState().point({ from: 'pty-other', target: { kind: 'project', projectPath: PROJECT } }),
    );
    await waitFor(() => expect(ribbon().textContent).toBe('2'));
    fireEvent.mouseEnter(ribbon());
    expect(screen.getByRole('dialog', { name: 'Pointers' }).textContent).toMatch(
      /Fix auth timeout points to Rate limit login/,
    );
    expect(screen.getByRole('dialog', { name: 'Pointers' }).textContent).toMatch(/Docs nav points here/);

    fireEvent.click(screen.getByRole('button', { name: "Dismiss Docs nav's pointer" }));
    expect(usePointerStore.getState().pointers.map((p) => p.from)).toEqual(['pty-agent']);

    // Following a ribbon that stands in keeps it, to land on the real thing; a second follow drops it regardless.
    window.api.task.getAll = vi.fn().mockResolvedValue([task]);
    fireEvent.click(ribbon());
    await waitFor(() => expect(useAppStore.getState().selection).toEqual(expect.objectContaining({ page: 'board' })));
    expect(usePointerStore.getState().pointers.map((p) => p.from)).toEqual(['pty-agent']);
    fireEvent.click(ribbon());
    await waitFor(() => expect(usePointerStore.getState().pointers).toEqual([]));
  });

  test('is followed by a click or ⌘J, and goes when the terminal that pointed closes', async () => {
    window.api.task.getAll = vi.fn().mockResolvedValue([task]);
    render(
      <>
        <Screen />
        <PointerLayer />
      </>,
    );
    act(() => usePointerStore.getState().point({ from: 'pty-agent', target: { kind: 'board', projectPath: PROJECT } }));
    act(() =>
      usePointerStore
        .getState()
        .point({ from: 'pty-other', target: { kind: 'task', projectPath: PROJECT, taskNumber: 14 } }),
    );

    // ⌘J takes the latest; with nothing open for the task, that is its card on the board.
    fireEvent.keyDown(document, { key: 'j', metaKey: true, ctrlKey: true });
    await waitFor(() =>
      expect(useAppStore.getState().selection).toEqual({ kind: 'page', projectPath: PROJECT, page: 'board' }),
    );
    expect(usePointerStore.getState().pointers.map((p) => p.from)).toEqual(['pty-agent']);

    act(() => useTerminalStore.getState().removeTerminal('pty-agent'));
    expect(usePointerStore.getState().pointers).toEqual([]);
  });
});

describe('an agent pointing', () => {
  test('is checked against what exists, and a note becomes its line', async () => {
    let send: (op: CliPointOp) => void = () => {};
    vi.mocked(window.api.cliPoints.onOp).mockImplementation((cb) => {
      send = cb;
      return () => {};
    });
    installCliPointListener();
    let requestId = 0;
    const point = async (op: Omit<CliPointOp, 'requestId' | 'fromPtyId'>): Promise<CliPointResponse> => {
      const id = ++requestId;
      send({ ...op, requestId: id, fromPtyId: 'pty-agent' });
      await waitFor(() =>
        expect(vi.mocked(window.api.cliPoints.respond).mock.calls.some(([r]) => r === id)).toBe(true),
      );
      return vi.mocked(window.api.cliPoints.respond).mock.calls.find(([r]) => r === id)![1];
    };
    terminalInstances.set('pty-agent', {
      worktreePath: '/wt/T-12',
      panels: [{ id: 'panel-1' }],
    } as unknown as OuijitTerminal);
    vi.mocked(window.api.task.getByNumber).mockImplementation(async (_p, n) => (n === 14 ? task : null));
    window.api.diffNotes.list = vi.fn().mockResolvedValue([{ id: 'n-1', path: 'src/auth.ts', line: 88 }]);

    expect(await point({ action: 'point', target: { kind: 'task', projectPath: PROJECT, taskNumber: 99 } })).toEqual({
      ok: false,
      error: 'Task 99 not found',
    });
    expect(await point({ action: 'point', target: { kind: 'panel', ptyId: 'pty-agent', panelId: 'panel-9' } })).toEqual(
      {
        ok: false,
        error: 'No panel panel-9 on pty-agent',
      },
    );
    expect(await point({ action: 'point', target: { kind: 'board', projectPath: '/elsewhere' } })).toEqual({
      ok: false,
      error: '/elsewhere is not a project in Ouijit',
    });
    expect(usePointerStore.getState().pointers).toEqual([]);

    await point({ action: 'point', target: { kind: 'diff', ptyId: 'pty-agent', path: 'src/auth.ts', line: 3 } });
    expect((await point({ action: 'note', noteId: 'n-1' })).target).toEqual({
      kind: 'diff',
      ptyId: 'pty-agent',
      path: 'src/auth.ts',
      line: 88,
      noteId: 'n-1',
    });
    // One pointer a terminal: the note replaced the diff line.
    expect(usePointerStore.getState().pointers.map((p) => p.target)).toEqual([
      expect.objectContaining({ kind: 'diff', noteId: 'n-1' }),
    ]);

    await point({ action: 'clear' });
    expect(usePointerStore.getState().pointers).toEqual([]);
    terminalInstances.delete('pty-agent');
  });
});
