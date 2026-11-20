import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Terminal } from '@xterm/headless';

import { WaitingDialog } from '../../components/waiting/WaitingDialog';
import { ToastContainer } from '../../components/ui/ToastContainer';
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
const tasks = [
  { taskNumber: 14, name: 'Rate limit login', status: 'in_progress', createdAt: '' },
  { taskNumber: 15, name: 'Write docs', status: 'in_progress', createdAt: '' },
] as TaskWithWorkspace[];

/** The code a preview shows, without its header or line numbers. */
function codeIn(preview: HTMLElement): string {
  return [...preview.querySelectorAll('[data-code-line]')].map((line) => line.textContent).join('\n');
}

const command = () => codeIn(screen.getByTestId('waiting-command'));
const toasts = () => screen.queryAllByRole('status');

/** A terminal's card on screen: the xterm it would type into, with what its agent left over it. */
function Card({ ptyId }: { ptyId: string }) {
  return (
    <div>
      <textarea aria-label={`xterm ${ptyId}`} />
      <WaitingDialog ptyId={ptyId} />
    </div>
  );
}

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

/** A runner on the agent's terminal that prints `line` and ends with `exitCode`, private if it was started so. */
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
            panels: [
              {
                id: 'panel-1',
                kind: 'runner',
                status,
                exitCode,
                private: vi.mocked(startRunner).mock.calls.at(-1)?.[1]?.private,
              } as never,
            ],
          },
        },
      })),
    );
}

beforeEach(() => {
  vi.mocked(startRunner).mockReset();
  useWaitingStore.setState({ items: [], shownOn: {} });
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
  test('from a terminal whose card is open, it shows over that card, script and all, and only answering closes it', async () => {
    const finish = runner('signed 3 binaries');
    vi.mocked(startRunner).mockResolvedValue('panel-1');
    render(
      <>
        <Card ptyId="pty-agent" />
        <ToastContainer />
      </>,
    );
    const { ask, reply } = cliAsks();

    const sign = ask('./scripts/sign.sh --all', {
      message: 'Signing needs the keychain',
      file: { path: 'scripts/sign.sh', contents: 'codesign --deep "$@"', size: 20 },
      runCommand: '/data/ask-runs/1/sign.sh --all',
    });
    await screen.findByText('Signing needs the keychain');
    // Who asks, as the sidebar names it, apart from what it says.
    const title = screen.getByTestId('dialog-title');
    within(title).getByText('Rate limit login');
    within(title).getByText('T-14');
    expect(command()).toBe('./scripts/sign.sh --all');
    expect(codeIn(screen.getByTestId('ask-file'))).toBe('codesign --deep "$@"');
    screen.getByText(/Runs on your computer, outside its sandbox\. The script runs as it was when asked/);
    expect(toasts()).toEqual([]);

    fireEvent.keyDown(document, { key: 'Escape' });
    finish('running');
    fireEvent.click(screen.getByTestId('waiting-run'));
    await waitFor(() =>
      expect(startRunner).toHaveBeenCalledWith('pty-agent', {
        name: './scripts/sign.sh --all',
        command: '/data/ask-runs/1/sign.sh --all',
        env: expect.objectContaining({ PAGER: 'cat', GH_PAGER: 'cat', GIT_PAGER: 'cat' }),
        private: false,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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

    // Run privately, the agent hears how it ended and nothing it printed.
    finish('running');
    const token = ask('gh auth token');
    fireEvent.click(await screen.findByTestId('waiting-run-private'));
    await waitFor(() =>
      expect(startRunner).toHaveBeenLastCalledWith('pty-agent', expect.objectContaining({ private: true })),
    );
    finish('success', 0);
    await waitFor(() =>
      expect(reply(token)).toEqual({
        ok: true,
        answer: { status: 'exited', panelId: 'panel-1', exitCode: 0, private: true },
      }),
    );

    // The run shortcut answers only from the card the keyboard is in.
    finish('running');
    ask('npm test');
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Enter', metaKey: true, ctrlKey: true });
    expect(startRunner).toHaveBeenCalledTimes(2);
    screen.getByLabelText('xterm pty-agent').focus();
    fireEvent.keyDown(document, { key: 'Enter', metaKey: true, ctrlKey: true });
    await waitFor(() => expect(startRunner).toHaveBeenCalledTimes(3));
  });

  test('from a terminal with no card open, it is a toast until answered, and still waits on its card once the toast is closed', async () => {
    vi.mocked(startRunner).mockResolvedValue('panel-1');
    runner('');
    const { rerender } = render(<ToastContainer />);
    const { ask } = cliAsks();
    const startHook = vi.fn();

    ask('npm run lint', { from: 'pty-shell' });
    ask('./scripts/sign.sh', { file: { path: 'scripts/sign.sh', contents: 'codesign "$@"', size: 13 } });
    act(() => {
      useWaitingStore.getState().add({
        kind: 'move',
        from: 'pty-agent',
        projectPath: PROJECT,
        taskNumber: 15,
        hookType: 'start',
        hookName: 'Agent',
        command: 'claude "$OUIJIT_TASK_DESCRIPTION"',
        outsideSandbox: true,
        run: startHook,
      });
    });
    await waitFor(() => expect(toasts()).toHaveLength(3));
    const [lint, sign, move] = toasts();

    // A plain command runs from its toast.
    within(lint).getByText('Scratch');
    within(lint).getByText('npm run lint');
    fireEvent.click(within(lint).getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(startRunner).toHaveBeenCalledWith('pty-shell', expect.anything()));

    // A held hook reads as what it does, and can be skipped there.
    within(move).getByText('Start Write docs');
    within(move).getByText('Agent, from Rate limit login');
    fireEvent.click(within(move).getByRole('button', { name: 'Skip' }));
    expect(startHook).not.toHaveBeenCalled();

    // A script is read before it runs, so its toast only leads to it. Closed, it still waits on its card.
    within(sign).getByText('Rate limit login');
    expect(within(sign).queryByRole('button', { name: 'Run' })).toBeNull();
    within(sign).getByRole('button', { name: 'Go to' });
    fireEvent.click(within(sign).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(toasts()).toEqual([]));
    rerender(
      <>
        <Card ptyId="pty-agent" />
        <ToastContainer />
      </>,
    );
    expect(command()).toBe('./scripts/sign.sh');
    expect(codeIn(screen.getByTestId('ask-file'))).toBe('codesign "$@"');
  });

  test('a hook an agent holds for its own task names the task once, and says nothing of where it runs inside the sandbox', async () => {
    render(<Card ptyId="pty-agent" />);
    act(() => {
      useWaitingStore.getState().add({
        kind: 'move',
        from: 'pty-agent',
        projectPath: PROJECT,
        taskNumber: 14,
        hookType: 'review',
        hookName: 'Review',
        command: 'gh pr create --fill',
        outsideSandbox: false,
        run: vi.fn(),
      });
    });
    await waitFor(() => expect(command()).toBe('gh pr create --fill'));
    expect(screen.getByTestId('dialog-title').textContent).toBe('Review Rate limit login');
    expect(screen.queryByText('Rate limit login')).toBeNull();
    expect(screen.queryByText('T-14')).toBeNull();
    expect(screen.queryByText(/Runs on your computer/)).toBeNull();
  });

  test('one from a terminal that closes is declined', async () => {
    render(<ToastContainer />);
    const { ask, reply } = cliAsks();
    const scratch = ask('rm -rf node_modules', { from: 'pty-shell' });
    await waitFor(() => expect(toasts()).toHaveLength(1));
    act(() =>
      useTerminalStore.setState((s) => {
        const { 'pty-shell': _, ...rest } = s.displayStates;
        return { displayStates: rest };
      }),
    );
    await waitFor(() => expect(reply(scratch)).toEqual({ ok: true, answer: { status: 'declined' } }));
    expect(toasts()).toEqual([]);
  });
});
