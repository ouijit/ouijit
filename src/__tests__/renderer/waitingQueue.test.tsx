import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Terminal } from '@xterm/headless';

import { WaitingQueue } from '../../components/waiting/WaitingQueue';
import { AskRunDialog } from '../../components/waiting/AskRunDialog';
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
const task = { taskNumber: 14, name: 'Rate limit login', status: 'in_progress', createdAt: '' } as TaskWithWorkspace;

/** The code a preview shows, without its header or line numbers. */
function codeIn(preview: HTMLElement): string {
  return [...preview.querySelectorAll('[data-code-line]')].map((line) => line.textContent).join('\n');
}

const queue = () => screen.queryByRole('button', { name: /waiting$/ });

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
  const ask = (run: AskRun, message?: string, fromPtyId = 'pty-agent'): number => {
    const id = ++requestId;
    send({ requestId: id, fromPtyId, ask: run, ...(message && { message }) });
    return id;
  };
  return { ask, reply };
}

function renderQueue() {
  return render(
    <>
      <WaitingQueue />
      <AskRunDialog />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(startRunner).mockReset();
  useWaitingStore.setState({ items: [], open: null });
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

afterEach(() => terminalInstances.delete('pty-agent'));

describe('an agent asking to run something', () => {
  test('waits in the queue until opened, never runs by being opened, and runs on Run in a runner the agent can wait on', async () => {
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
    renderQueue();
    const { ask, reply } = cliAsks();
    const sign = {
      command: './scripts/sign.sh --all',
      cwd: '/wt/T-12',
      file: { path: 'scripts/sign.sh', contents: 'codesign --deep "$@"' },
      runCommand: '/data/ask-runs/1/sign.sh --all',
    };

    const waiting = ask({ ...sign, wait: true }, 'Needs the keychain');
    await waitFor(() => expect(queue()?.textContent).toBe('1 waiting'));

    // ⌘J opens it, showing what runs and the file it runs; closing it leaves it in the queue.
    fireEvent.keyDown(document, { key: 'j', metaKey: true, ctrlKey: true });
    expect(codeIn(await screen.findByTestId('ask-command'))).toBe('./scripts/sign.sh --all');
    expect(codeIn(screen.getByTestId('ask-file'))).toBe('codesign --deep "$@"');
    screen.getByText(/The script runs as shown, even if the file changes\./);
    screen.getByText('Needs the keychain');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('ask-command')).toBeNull());
    expect(queue()?.textContent).toBe('1 waiting');
    expect(startRunner).not.toHaveBeenCalled();
    expect(reply(waiting)).toBeUndefined();

    // The queue lists it by who asks and what runs; picking it opens it again.
    fireEvent.click(queue()!);
    fireEvent.click(await screen.findByRole('button', { name: /Fix auth timeout asks to run/ }));
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
    expect(queue()).toBeNull();
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

    // Without --wait the answer is that it is pending; declining from the queue refuses it.
    const later = ask(sign);
    await waitFor(() => expect(reply(later)).toEqual({ ok: true, answer: { status: 'pending' } }));
    const refused = ask({ ...sign, wait: true });
    fireEvent.click(await screen.findByRole('button', { name: /waiting$/ }));
    // Answered pending, the first stays in the queue for the user; the second is declined there.
    const declines = await screen.findAllByRole('button', { name: 'Decline: ./scripts/sign.sh --all' });
    expect(declines).toHaveLength(2);
    fireEvent.click(declines[1]);
    await waitFor(() => expect(reply(refused)).toEqual({ ok: true, answer: { status: 'declined' } }));
    expect(startRunner).toHaveBeenCalledTimes(1);
    expect(queue()?.textContent).toBe('1 waiting');
  });

  test('from the terminal in front opens at once; from one behind it waits; from one that closes is declined', async () => {
    useTerminalStore.setState((s) => ({
      displayStates: {
        ...s.displayStates,
        'pty-agent': { ...s.displayStates['pty-agent'], taskId: 14 },
        'pty-other': { ...s.displayStates['pty-other'], taskId: 14 },
      },
    }));
    useAppStore.setState({ selection: { kind: 'terminal', stack: `task:14:${PROJECT}`, projectPath: PROJECT } });
    renderQueue();
    const { ask, reply } = cliAsks();
    const e2e = { command: 'npm run e2e', cwd: '/wt/T-14', wait: true };

    const behind = ask(e2e, undefined, 'pty-other');
    await waitFor(() => expect(queue()?.textContent).toBe('1 waiting'));
    expect(screen.queryByTestId('ask-command')).toBeNull();

    ask(e2e);
    expect(codeIn(await screen.findByTestId('ask-command'))).toBe('npm run e2e');
    screen.getByText('1 more waiting');
    expect(startRunner).not.toHaveBeenCalled();

    act(() =>
      useTerminalStore.setState((s) => {
        const { 'pty-other': _, ...rest } = s.displayStates;
        return { displayStates: rest };
      }),
    );
    await waitFor(() => expect(reply(behind)).toEqual({ ok: true, answer: { status: 'declined' } }));
    expect(queue()?.textContent).toBe('1 waiting');
  });

  test('sent one after another from one terminal, each comes up as the one before is answered', async () => {
    vi.mocked(startRunner).mockResolvedValue('panel-r');
    renderQueue();
    const { ask, reply } = cliAsks();
    const trash = (n: number) => ask({ command: `ouijit task trash ${n}`, cwd: '/wt/T-29', wait: true }, `Trash ${n}`);
    const asked = [trash(31), trash(32), trash(33)];

    await waitFor(() => expect(queue()?.textContent).toBe('3 waiting'));
    expect(asked.map(reply)).toEqual([undefined, undefined, undefined]);

    fireEvent.keyDown(document, { key: 'j', metaKey: true, ctrlKey: true });
    expect(codeIn(await screen.findByTestId('ask-command'))).toBe('ouijit task trash 31');
    screen.getByText('Trash 31');
    screen.getByText('2 more waiting');
    fireEvent.click(screen.getByTestId('ask-run'));

    await waitFor(() => expect(codeIn(screen.getByTestId('ask-command'))).toBe('ouijit task trash 32'));
    screen.getByText('Trash 32');
    fireEvent.click(screen.getByTestId('ask-decline'));
    await waitFor(() => expect(reply(asked[1])).toEqual({ ok: true, answer: { status: 'declined' } }));

    await waitFor(() => expect(codeIn(screen.getByTestId('ask-command'))).toBe('ouijit task trash 33'));
    fireEvent.click(screen.getByTestId('ask-run'));
    await waitFor(() => expect(queue()).toBeNull());
    expect(vi.mocked(startRunner).mock.calls.map(([, script]) => script?.command)).toEqual([
      'ouijit task trash 31',
      'ouijit task trash 33',
    ]);
  });
});
