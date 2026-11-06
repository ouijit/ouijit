import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Terminal } from '@xterm/headless';

import { WaitingQueue } from '../../components/waiting/WaitingQueue';
import { installCliAskListener } from '../../services/cliAskListener';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import { useAppStore } from '../../stores/appStore';
import { useWaitingStore } from '../../stores/waitingStore';
import { startRunner } from '../../components/terminal/terminalActions';
import { DEFAULT_DISPLAY_STATE, useTerminalStore } from '../../stores/terminalStore';
import type { AskRun, CliAskOp, TaskWithWorkspace } from '../../types';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// A runner spawns a PTY, which jsdom cannot.
vi.mock('../../components/terminal/terminalActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/terminal/terminalActions')>()),
  startRunner: vi.fn(),
}));

const PROJECT = '/code/alpha';
const tasks = [{ taskNumber: 15, name: 'Write docs', status: 'in_progress', createdAt: '' }] as TaskWithWorkspace[];

/** The code a preview shows, without its header or line numbers. */
function codeIn(preview: HTMLElement): string {
  return [...preview.querySelectorAll('[data-code-line]')].map((line) => line.textContent).join('\n');
}

const command = () => codeIn(screen.getByTestId('waiting-command'));
const list = () => screen.queryByRole('navigation', { name: 'Waiting' });

function cliAsks() {
  let send: (op: CliAskOp) => void = () => {};
  vi.mocked(window.api.cliAsks.onOp).mockImplementation((cb) => {
    send = cb;
    return () => {};
  });
  vi.mocked(window.api.cliAsks.respond).mockClear();
  installCliAskListener();
  let requestId = 0;
  const reply = (id: number) => vi.mocked(window.api.cliAsks.respond).mock.calls.find(([r]) => r === id)?.[1];
  const ask = (
    run: string,
    { message, from = 'pty-agent', ...rest }: Partial<AskRun> & { message?: string; from?: string } = {},
  ) => {
    const id = ++requestId;
    send({
      requestId: id,
      fromPtyId: from,
      ask: { command: run, cwd: '/wt/T-14', wait: true, ...rest },
      ...(message && { message }),
    });
    return id;
  };
  return { ask, reply };
}

/** A runner on the agent's terminal that prints `line` and ends with `exitCode`. */
function runner(line: string) {
  const xterm = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
  xterm.write(`${line}\r\n`);
  terminalInstances.set('pty-agent', {
    worktreePath: '/wt/T-14',
    panels: [],
    runnerChildren: new Map([['panel-1', { xterm }]]),
  } as unknown as OuijitTerminal);
  return (status: string, exitCode?: number) =>
    act(() =>
      useTerminalStore.setState((s) => ({
        displayStates: {
          ...s.displayStates,
          'pty-agent': {
            ...s.displayStates['pty-agent'],
            panels: [{ id: 'panel-1', kind: 'runner', status, exitCode } as never],
          },
        },
      })),
    );
}

beforeEach(() => {
  vi.mocked(startRunner).mockReset();
  useWaitingStore.setState({ items: [], open: false, selected: null });
  useAppStore.setState({
    projects: [{ path: PROJECT, name: 'alpha' } as never],
    taskCacheByProject: { [PROJECT]: tasks },
    selection: { kind: 'terminal', stack: `task:14:${PROJECT}`, projectPath: PROJECT },
  });
  const display = (ptyId: string, label: string, extra = {}) => ({
    ...DEFAULT_DISPLAY_STATE,
    ptyId,
    projectPath: PROJECT,
    label,
    ...extra,
  });
  useTerminalStore.setState({
    order: ['pty-agent', 'pty-shell'],
    terminalsByProject: { [PROJECT]: ['pty-agent', 'pty-shell'] },
    displayStates: {
      'pty-agent': display('pty-agent', 'Rate limit login', { taskId: 14, sandboxProvider: 'nono' }),
      'pty-shell': display('pty-shell', 'Scratch'),
    },
  });
});

afterEach(() => terminalInstances.delete('pty-agent'));

describe('what an agent leaves for the user', () => {
  test('one ask opens on its own from the terminal on screen, script and all, and runs the copy that was read', async () => {
    const finish = runner('signed 3 binaries');
    vi.mocked(startRunner).mockResolvedValue('panel-1');
    render(<WaitingQueue />);
    const { ask, reply } = cliAsks();

    const sign = ask('./scripts/sign.sh --all', {
      message: 'Signing needs the keychain',
      file: { path: 'scripts/sign.sh', contents: 'codesign --deep "$@"', size: 20 },
      runCommand: '/data/ask-runs/1/sign.sh --all',
    });
    await screen.findByText('Signing needs the keychain');
    expect(command()).toBe('./scripts/sign.sh --all');
    expect(codeIn(screen.getByTestId('ask-file'))).toBe('codesign --deep "$@"');
    screen.getByText(/Runs on your computer, outside its sandbox\. The script runs as it was when asked/);
    expect(list()).toBeNull();

    // Closed, it still waits behind the count, which opens it again.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('waiting-command')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }));
    finish('running');
    fireEvent.click(await screen.findByTestId('waiting-run'));
    await waitFor(() =>
      expect(startRunner).toHaveBeenCalledWith('pty-agent', {
        name: './scripts/sign.sh --all',
        command: '/data/ask-runs/1/sign.sh --all',
        env: expect.objectContaining({ PAGER: 'cat', GH_PAGER: 'cat', GIT_PAGER: 'cat' }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /waiting$/ })).toBeNull());
    finish('success', 0);
    await waitFor(() =>
      expect(reply(sign)).toEqual({
        ok: true,
        answer: {
          status: 'exited',
          panelId: 'panel-1',
          exitCode: 0,
          output: expect.stringContaining('signed 3 binaries'),
        },
      }),
    );
  });

  test('several show as a list beside the one in view, taken in any order, each answered moving to the next', async () => {
    vi.mocked(startRunner).mockResolvedValue('panel-1');
    runner('');
    useAppStore.setState({ selection: { kind: 'none' } });
    render(<WaitingQueue />);
    const { ask, reply } = cliAsks();
    const startHook = vi.fn();

    const lint = ask('npm run lint');
    const publish = ask('npm publish', { message: 'Ship it' });
    const scratch = ask('rm -rf node_modules', { from: 'pty-shell' });
    act(() => {
      useWaitingStore.getState().add({
        kind: 'move',
        from: 'pty-agent',
        projectPath: PROJECT,
        taskNumber: 15,
        hookType: 'start',
        hookName: 'Agent',
        command: 'claude "$OUIJIT_TASK_DESCRIPTION"',
        outsideSandbox: false,
        run: startHook,
      });
    });

    // Nothing opened over another terminal: the count waits for the user.
    await screen.findByRole('button', { name: '4 waiting' });
    expect(screen.queryByTestId('waiting-command')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true, ctrlKey: true });
    const nav = await screen.findByRole('navigation', { name: 'Waiting' });
    within(nav).getByText('4 waiting on you');
    within(nav).getByText('Start Write docs');
    within(nav).getByText('Agent, from Rate limit login');
    expect(command()).toBe('npm run lint');

    // Picked out of order: the held hook reads as what it does.
    fireEvent.click(within(nav).getByText('Start Write docs'));
    screen.getByText('Rate limit login moved Write docs to In Progress.');
    expect(command()).toBe('claude "$OUIJIT_TASK_DESCRIPTION"');
    fireEvent.click(screen.getByTestId('waiting-decline'));
    expect(startHook).not.toHaveBeenCalled();

    // Answering moves to the one in its place.
    expect(command()).toBe('rm -rf node_modules');
    fireEvent.click(screen.getByTestId('waiting-decline'));
    await waitFor(() => expect(reply(scratch)).toEqual({ ok: true, answer: { status: 'declined' } }));
    expect(command()).toBe('npm publish');

    // Run all takes the rest, and the dialog goes with the last of them.
    fireEvent.click(screen.getByRole('button', { name: 'Run all 2' }));
    await waitFor(() => expect(startRunner).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(list()).toBeNull());
    expect(screen.queryByRole('button', { name: /waiting$/ })).toBeNull();
    expect([reply(lint), reply(publish)].every((r) => r === undefined || r.ok)).toBe(true);
  });

  test('one from a terminal that closes is declined', async () => {
    render(<WaitingQueue />);
    const { ask, reply } = cliAsks();
    const scratch = ask('rm -rf node_modules', { from: 'pty-shell' });
    await screen.findByRole('button', { name: '1 waiting' });
    act(() =>
      useTerminalStore.setState((s) => {
        const { 'pty-shell': _, ...rest } = s.displayStates;
        return { displayStates: rest };
      }),
    );
    await waitFor(() => expect(reply(scratch)).toEqual({ ok: true, answer: { status: 'declined' } }));
    expect(screen.queryByRole('button', { name: /waiting$/ })).toBeNull();
  });
});
