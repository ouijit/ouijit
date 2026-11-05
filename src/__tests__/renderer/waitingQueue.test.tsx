import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Terminal } from '@xterm/headless';

import { AskBar, WaitingQueue } from '../../components/waiting/WaitingQueue';
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

const bars = () => screen.getAllByRole('region', { name: 'Waiting on you' });
const rowOf = (command: string) =>
  screen
    .getAllByTestId('waiting-row')
    .find((row) => within(row).getByTestId('waiting-command').textContent === command)!;

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
    command: string,
    { message, from = 'pty-agent', ...rest }: Partial<AskRun> & { message?: string; from?: string } = {},
  ) => {
    const id = ++requestId;
    send({
      requestId: id,
      fromPtyId: from,
      ask: { command, cwd: '/wt/T-14', wait: true, ...rest },
      ...(message && { message }),
    });
    return id;
  };
  return { ask, reply };
}

/** Runners on the agent's terminal, each having printed the line given. */
function runners(outputs: Record<string, string>) {
  const children = new Map<string, { xterm: Terminal }>();
  for (const [panelId, line] of Object.entries(outputs)) {
    const xterm = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    xterm.write(`${line}\r\n`);
    children.set(panelId, { xterm });
  }
  const activatePanel = vi.fn();
  terminalInstances.set('pty-agent', {
    worktreePath: '/wt/T-14',
    panels: [],
    runnerChildren: children,
    activatePanel,
  } as unknown as OuijitTerminal);
  const panels = (list: { id: string; status: string; exitCode?: number }[]) =>
    act(() =>
      useTerminalStore.setState((s) => ({
        displayStates: {
          ...s.displayStates,
          'pty-agent': {
            ...s.displayStates['pty-agent'],
            panels: list.map((p) => ({ ...p, kind: 'runner' }) as never),
          },
        },
      })),
    );
  return { panels, activatePanel };
}

beforeEach(() => {
  vi.mocked(startRunner).mockReset();
  useWaitingStore.setState({ items: [] });
  useAppStore.setState({
    projects: [{ path: PROJECT, name: 'alpha' } as never],
    taskCacheByProject: { [PROJECT]: tasks },
    selection: { kind: 'none' },
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
  test('shows all at once on the terminal that asked, run or declined one by one or together, a failed run staying', async () => {
    const { panels, activatePanel } = runners({ 'panel-1': 'signed 3 binaries', 'panel-2': 'lint: 2 errors' });
    vi.mocked(startRunner).mockResolvedValueOnce('panel-1').mockResolvedValueOnce('panel-2');
    render(
      <>
        <AskBar ptyId="pty-agent" />
        <AskBar ptyId="pty-shell" />
      </>,
    );
    const { ask, reply } = cliAsks();
    const startHook = vi.fn();

    const sign = ask('./scripts/sign.sh --all', {
      message: 'Signing needs the keychain',
      file: { path: 'scripts/sign.sh', contents: 'codesign --deep "$@"', size: 20 },
      runCommand: '/data/ask-runs/1/sign.sh --all',
    });
    const lint = ask('npm run lint');
    const publish = ask('npm publish');
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

    // Every item from the agent, at once, on its own terminal; the shell's on the shell.
    await waitFor(() => within(bars()[0]).getByText('4 waiting on you'));
    expect(bars()).toHaveLength(2);
    within(rowOf('./scripts/sign.sh --all')).getByText('Signing needs the keychain');
    within(rowOf('./scripts/sign.sh --all')).getByText('outside its sandbox');
    within(rowOf('claude "$OUIJIT_TASK_DESCRIPTION"')).getByText('Start Write docs');
    within(rowOf('claude "$OUIJIT_TASK_DESCRIPTION"')).getByText(/^Agent:/);

    // The script it runs, on asking.
    fireEvent.click(within(rowOf('./scripts/sign.sh --all')).getByRole('button', { name: 'Script' }));
    expect((await screen.findByTestId('ask-file')).textContent).toContain('codesign --deep');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('ask-file')).toBeNull());

    // Run: the copy that was read runs, with no pager, and the row stays until the run ends.
    panels([{ id: 'panel-1', status: 'running' }]);
    fireEvent.click(within(rowOf('./scripts/sign.sh --all')).getByRole('button', { name: 'Run' }));
    await waitFor(() => within(rowOf('./scripts/sign.sh --all')).getByText('Running…'));
    expect(startRunner).toHaveBeenCalledWith('pty-agent', {
      name: './scripts/sign.sh --all',
      command: '/data/ask-runs/1/sign.sh --all',
      env: expect.objectContaining({ PAGER: 'cat', GH_PAGER: 'cat', GIT_PAGER: 'cat' }),
    });
    panels([{ id: 'panel-1', status: 'success', exitCode: 0 }]);
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
    expect(screen.queryByText('./scripts/sign.sh --all')).toBeNull();

    // A failed run stays, its runner a click away.
    panels([{ id: 'panel-2', status: 'running' }]);
    fireEvent.click(within(rowOf('npm run lint')).getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(startRunner).toHaveBeenCalledTimes(2));
    panels([{ id: 'panel-2', status: 'error', exitCode: 1 }]);
    await waitFor(() => within(rowOf('npm run lint')).getByText('Failed, exit 1'));
    expect(reply(lint)).toEqual({ ok: true, answer: expect.objectContaining({ status: 'exited', exitCode: 1 }) });
    fireEvent.click(within(rowOf('npm run lint')).getByRole('button', { name: 'Show runner' }));
    expect(activatePanel).toHaveBeenCalledWith('panel-2');
    fireEvent.click(within(rowOf('npm run lint')).getByRole('button', { name: 'Dismiss' }));

    // Decline all takes this terminal's, and only this terminal's.
    fireEvent.click(within(bars()[0]).getByRole('button', { name: 'Decline all' }));
    await waitFor(() => expect(reply(publish)).toEqual({ ok: true, answer: { status: 'declined' } }));
    expect(startHook).not.toHaveBeenCalled();
    expect(reply(scratch)).toBeUndefined();
    expect(bars()).toHaveLength(1);
  });

  test('is counted in the title bar, by terminal, and gone when its terminal is', async () => {
    render(<WaitingQueue />);
    const { ask, reply } = cliAsks();
    ask('npm run e2e');
    ask('npm run bench');
    const scratch = ask('rm -rf node_modules', { from: 'pty-shell' });
    const count = await screen.findByRole('button', { name: '3 waiting' });

    fireEvent.click(count);
    const agent = await screen.findByRole('button', { name: /Rate limit login/ });
    expect(agent.textContent).toContain('npm run e2e, npm run bench');
    screen.getByRole('button', { name: /Scratch/ });

    act(() =>
      useTerminalStore.setState((s) => {
        const { 'pty-shell': _, ...rest } = s.displayStates;
        return { displayStates: rest };
      }),
    );
    await waitFor(() => expect(reply(scratch)).toEqual({ ok: true, answer: { status: 'declined' } }));
    await screen.findByRole('button', { name: '2 waiting' });
  });
});
