import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Terminal } from '@xterm/headless';

import { PointerLayer } from '../../components/point/PointerLayer';
import { installCliPointListener } from '../../services/cliPointListener';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import { pointKey } from '../../components/point/pointKeys';
import { useAppStore } from '../../stores/appStore';
import { usePointerStore } from '../../stores/pointerStore';
import { startRunner } from '../../components/terminal/terminalActions';
import { DEFAULT_DISPLAY_STATE, useTerminalStore } from '../../stores/terminalStore';
import type { CliPointOp, CliPointResponse, TaskWithWorkspace } from '../../types';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// A runner spawns a PTY, which jsdom cannot.
vi.mock('../../components/terminal/terminalActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/terminal/terminalActions')>()),
  startRunner: vi.fn(),
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

function Screen({ rows = true }: { rows?: boolean }) {
  return (
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
  );
}

/** The code a preview shows, without its header or line numbers. */
function codeIn(preview: HTMLElement): string {
  return [...preview.querySelectorAll('[data-code-line]')].map((line) => line.textContent).join('\n');
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
  test('lands on its sidebar row, or the row holding it, counts pointers, and is labelled by its message', async () => {
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

    // The row's right edge, overlapping it a little.
    await waitFor(() => expect(ribbon().style.left).toBe('252px'));
    expect(ribbon().getAttribute('aria-label')).toBe('Follow Fix auth timeout, which points here');

    // With the project folded, its header stands in, naming what is really meant.
    rerender(
      <>
        <Screen rows={false} />
        <PointerLayer />
      </>,
    );
    await waitFor(() =>
      expect(ribbon().getAttribute('aria-label')).toBe('Follow Fix auth timeout, which points to Rate limit login'),
    );
    expect(ribbon().style.top).toBe(`${50 + 15 - 12}px`);

    // A second agent at the same row: one mark, counting both, each listed on hover.
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

    // A message is the pointer's label, the terminal it came from beneath it.
    act(() =>
      usePointerStore.getState().point({
        from: 'pty-other',
        target: { kind: 'project', projectPath: PROJECT },
        message: 'Tests still to write',
      }),
    );
    await waitFor(() => expect(ribbon().getAttribute('aria-label')).toBe('Follow Tests still to write, from Docs nav'));
    fireEvent.mouseEnter(ribbon());
    expect(screen.getByRole('dialog', { name: 'Pointers' }).textContent).toMatch(/Tests still to writeDocs nav/);
    act(() => usePointerStore.getState().dismiss('pty-other'));

    // A new pointer from the same terminal at the same thing is drawn afresh, not left as the old one.
    act(() =>
      usePointerStore.getState().point({
        from: 'pty-agent',
        target: { kind: 'task', projectPath: PROJECT, taskNumber: 14 },
        message: 'Now with tests',
      }),
    );
    await waitFor(() =>
      expect(ribbon().getAttribute('aria-label')).toBe('Follow Now with tests, from Fix auth timeout'),
    );

    // Following goes there and drops it.
    window.api.task.getAll = vi.fn().mockResolvedValue([task]);
    fireEvent.click(ribbon());
    await waitFor(() => expect(useAppStore.getState().selection).toEqual(expect.objectContaining({ page: 'board' })));
    expect(usePointerStore.getState().pointers).toEqual([]);
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

/** The CLI's side of the point bridge: send an op as pty-agent, and read the reply when it comes. */
function cliPoints() {
  let send: (op: CliPointOp) => void = () => {};
  vi.mocked(window.api.cliPoints.onOp).mockImplementation((cb) => {
    send = cb;
    return () => {};
  });
  vi.mocked(window.api.cliPoints.respond).mockClear();
  installCliPointListener();
  let requestId = 0;
  const reply = (id: number) => vi.mocked(window.api.cliPoints.respond).mock.calls.find(([r]) => r === id)?.[1];
  const sendOp = (op: Omit<CliPointOp, 'requestId' | 'fromPtyId'>, fromPtyId = 'pty-agent'): number => {
    const id = ++requestId;
    send({ ...op, requestId: id, fromPtyId });
    return id;
  };
  const point = async (op: Omit<CliPointOp, 'requestId' | 'fromPtyId'>): Promise<CliPointResponse> => {
    const id = sendOp(op);
    await waitFor(() => expect(reply(id)).toBeDefined());
    return reply(id)!;
  };
  return { sendOp, reply, point };
}

describe('an agent pointing', () => {
  test('is checked against what exists, and a note becomes its line', async () => {
    const { point } = cliPoints();
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

describe('an agent asking to run something', () => {
  afterEach(() => terminalInstances.delete('pty-agent'));

  test('is opened by following, never run by it, and runs on Run in a runner whose result the agent can wait for', async () => {
    const runner = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    await new Promise<void>((done) => runner.write('signed 3 binaries\r\n', done));
    terminalInstances.set('pty-agent', {
      worktreePath: '/wt/T-12',
      panels: [],
      runnerChildren: new Map([['panel-r', { xterm: runner }]]),
      fit: () => {},
      xterm: { focus: () => {} },
    } as unknown as OuijitTerminal);
    const runnerPanel = (status: string, exitCode?: number) =>
      act(() =>
        useTerminalStore.setState((s) => ({
          displayStates: {
            ...s.displayStates,
            'pty-agent': {
              ...s.displayStates['pty-agent'],
              panels: [{ id: 'panel-r', kind: 'runner', status, exitCode } as never],
            },
          },
        })),
      );
    vi.mocked(startRunner).mockResolvedValue('panel-r');
    render(
      <>
        <Screen />
        <PointerLayer />
      </>,
    );
    const { sendOp, reply, point } = cliPoints();
    const ask = {
      command: './scripts/sign.sh --all',
      cwd: '/wt/T-12',
      file: { path: 'scripts/sign.sh', contents: 'codesign --deep "$@"' },
      runCommand: '/data/ask-runs/1/sign.sh --all',
    };

    const waiting = sendOp({ action: 'ask', ask: { ...ask, wait: true }, message: 'Needs the keychain' });
    await waitFor(() =>
      expect(ribbon().getAttribute('aria-label')).toMatch(/Fix auth timeout, which asks to run \.\/scripts\/sign\.sh/),
    );

    // ⌘J opens it, showing what runs and the file it runs; closing it leaves it waiting.
    fireEvent.keyDown(document, { key: 'j', metaKey: true, ctrlKey: true });
    expect(codeIn(await screen.findByTestId('ask-command'))).toBe('./scripts/sign.sh --all');
    expect(codeIn(screen.getByTestId('ask-file'))).toBe('codesign --deep "$@"');
    screen.getByText(/The script runs as shown, even if the file changes\./);
    screen.getByText('Needs the keychain');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('ask-command')).toBeNull());
    expect(startRunner).not.toHaveBeenCalled();
    expect(reply(waiting)).toBeUndefined();

    fireEvent.click(ribbon());
    runnerPanel('running');
    fireEvent.click(await screen.findByTestId('ask-run'));
    await waitFor(() =>
      // The copy that was read runs, not the file the agent can still edit, and nothing waits on a pager.
      expect(startRunner).toHaveBeenCalledWith('pty-agent', {
        name: './scripts/sign.sh --all',
        command: '/data/ask-runs/1/sign.sh --all',
        env: expect.objectContaining({ PAGER: 'cat', GH_PAGER: 'cat', GIT_PAGER: 'cat' }),
      }),
    );
    expect(usePointerStore.getState().pointers).toEqual([]);
    expect(reply(waiting)).toBeUndefined();

    runnerPanel('success', 0);
    await waitFor(() =>
      expect(reply(waiting)).toEqual({
        ok: true,
        answer: {
          status: 'exited',
          panelId: 'panel-r',
          exitCode: 0,
          output: expect.stringContaining('signed 3 binaries'),
        },
      }),
    );

    // Without --wait the answer is that it is pending; declining, or the agent pointing elsewhere, refuses it.
    expect(await point({ action: 'ask', ask })).toEqual({ ok: true, answer: { status: 'pending' } });
    await followAndDecline();
    const replaced = sendOp({ action: 'ask', ask: { ...ask, wait: true } });
    await waitFor(() => expect(usePointerStore.getState().pointers).toHaveLength(1));
    await point({ action: 'point', target: { kind: 'board', projectPath: PROJECT } });
    expect(reply(replaced)).toEqual({ ok: true, answer: { status: 'declined' } });
    expect(startRunner).toHaveBeenCalledTimes(1);
  });
});

test('an ask from the terminal in front opens at once, and one from a card behind it waits as its pointer', async () => {
  vi.mocked(startRunner).mockClear();
  useTerminalStore.setState((s) => ({
    displayStates: {
      ...s.displayStates,
      'pty-agent': { ...s.displayStates['pty-agent'], taskId: 14 },
      'pty-other': { ...s.displayStates['pty-other'], taskId: 14 },
    },
  }));
  useAppStore.setState({ selection: { kind: 'terminal', stack: `task:14:${PROJECT}`, projectPath: PROJECT } });
  render(
    <>
      <Screen />
      <PointerLayer />
    </>,
  );
  const { sendOp } = cliPoints();
  const ask = { command: 'npm run e2e', cwd: '/wt/T-14' };

  sendOp({ action: 'ask', ask }, 'pty-other');
  await waitFor(() => expect(usePointerStore.getState().pointers).toHaveLength(1));
  expect(screen.queryByTestId('ask-command')).toBeNull();

  sendOp({ action: 'ask', ask });
  expect(codeIn(await screen.findByTestId('ask-command'))).toBe('npm run e2e');
  expect(usePointerStore.getState().asking).toBe('pty-agent');
  expect(startRunner).not.toHaveBeenCalled();
});

test('a pointer holding several waiting moves says how many wait behind the one it points at', async () => {
  render(
    <>
      <Screen />
      <PointerLayer />
    </>,
  );
  act(() => {
    for (const taskNumber of [12, 13, 14]) {
      usePointerStore
        .getState()
        .point({ from: 'pty-agent', target: { kind: 'task', projectPath: PROJECT, taskNumber }, move: () => {} });
    }
  });
  await waitFor(() => expect(ribbon().getAttribute('aria-label')).toMatch(/, and 2 more waiting$/));
});

test('asks sent one after another wait in line on one pointer, each coming up as the one before is answered', async () => {
  vi.mocked(startRunner).mockClear();
  vi.mocked(startRunner).mockResolvedValue('panel-r');
  render(
    <>
      <Screen />
      <PointerLayer />
    </>,
  );
  const { sendOp, reply } = cliPoints();
  const trash = (n: number) =>
    sendOp({
      action: 'ask',
      ask: { command: `ouijit task trash ${n}`, cwd: '/wt/T-29', wait: true },
      message: `Trash ${n}`,
    });
  const asked = [trash(31), trash(32), trash(33)];

  await waitFor(() => expect(ribbon().getAttribute('aria-label')).toMatch(/trash 31, and 2 more waiting$/));
  expect(asked.map(reply)).toEqual([undefined, undefined, undefined]);

  fireEvent.click(ribbon());
  expect(codeIn(await screen.findByTestId('ask-command'))).toBe('ouijit task trash 31');
  screen.getByText('Trash 31');
  screen.getByText(/2 more after this/);
  fireEvent.click(screen.getByTestId('ask-run'));

  // The next one is up in the same card, with its own message.
  await waitFor(() => expect(codeIn(screen.getByTestId('ask-command'))).toBe('ouijit task trash 32'));
  screen.getByText('Trash 32');
  fireEvent.click(screen.getByTestId('ask-decline'));
  await waitFor(() => expect(reply(asked[1])).toEqual({ ok: true, answer: { status: 'declined' } }));

  await waitFor(() => expect(codeIn(screen.getByTestId('ask-command'))).toBe('ouijit task trash 33'));
  fireEvent.click(screen.getByTestId('ask-run'));
  await waitFor(() => expect(usePointerStore.getState().pointers).toEqual([]));
  expect(vi.mocked(startRunner).mock.calls.map(([, script]) => script?.command)).toEqual([
    'ouijit task trash 31',
    'ouijit task trash 33',
  ]);
});

async function followAndDecline(): Promise<void> {
  fireEvent.click(ribbon());
  fireEvent.click(await screen.findByTestId('ask-decline'));
  await waitFor(() => expect(usePointerStore.getState().pointers).toEqual([]));
}
