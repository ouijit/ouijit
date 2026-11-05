import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const tasks = [
  { taskNumber: 14, name: 'Rate limit login', status: 'in_progress', createdAt: '' },
  { taskNumber: 15, name: 'Write docs', status: 'in_progress', createdAt: '' },
] as TaskWithWorkspace[];

/** The code a preview shows, without its header or line numbers. */
function codeIn(preview: HTMLElement): string {
  return [...preview.querySelectorAll('[data-code-line]')].map((line) => line.textContent).join('\n');
}

const count = () => screen.queryByRole('button', { name: /waiting$/ });
const list = () => screen.queryByRole('heading', { name: 'Waiting on you' });
const rowOf = (command: string) =>
  screen
    .getAllByTestId('waiting-row')
    .find((row) => within(row).getByTestId('waiting-command').textContent === command)!;
const openList = () => fireEvent.keyDown(document, { key: 'j', metaKey: true, ctrlKey: true });

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

/** Runners on the agent's terminal, each finishing with the line given. */
function runners(outputs: Record<string, string>) {
  const children = new Map<string, { xterm: Terminal }>();
  for (const [panelId, line] of Object.entries(outputs)) {
    const xterm = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    xterm.write(`${line}\r\n`);
    children.set(panelId, { xterm });
  }
  terminalInstances.set('pty-agent', {
    worktreePath: '/wt/T-14',
    panels: [],
    runnerChildren: children,
    fit: () => {},
    xterm: { focus: () => {} },
    activatePanel: vi.fn(),
  } as unknown as OuijitTerminal);
  return (panels: { id: string; status: string; exitCode?: number }[]) =>
    act(() =>
      useTerminalStore.setState((s) => ({
        displayStates: {
          ...s.displayStates,
          'pty-agent': {
            ...s.displayStates['pty-agent'],
            panels: panels.map((p) => ({ ...p, kind: 'runner' }) as never),
          },
        },
      })),
    );
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
  useWaitingStore.setState({ items: [], open: null, listOpen: false });
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
    order: ['pty-agent', 'pty-other', 'pty-shell'],
    terminalsByProject: { [PROJECT]: ['pty-agent', 'pty-other', 'pty-shell'] },
    displayStates: {
      'pty-agent': display('pty-agent', 'Rate limit login', { taskId: 14 }),
      'pty-other': display('pty-other', 'Rate limit login', { taskId: 14, sandboxProvider: 'nono' }),
      'pty-shell': display('pty-shell', 'Scratch'),
    },
  });
});

afterEach(() => terminalInstances.delete('pty-agent'));

describe('the queue', () => {
  test('lists everything waiting by task or terminal, and runs a batch once every command in it has been read', async () => {
    const finish = runners({ 'panel-1': 'migrated 3 tables', 'panel-2': 'lint: 2 errors' });
    vi.mocked(startRunner).mockResolvedValueOnce('panel-1').mockResolvedValueOnce('panel-2');
    renderQueue();
    const { ask, reply } = cliAsks();
    const startHook = vi.fn();

    // Five items from three terminals.
    const migrate = ask('npm run migrate', { message: 'Needs the prod database url' });
    const lint = ask('npm run lint');
    ask('gh release create v2', { from: 'pty-other', message: 'Tag the release' });
    ask('rm -rf node_modules', { from: 'pty-shell' });
    act(() => {
      useWaitingStore.getState().add({
        kind: 'move',
        from: 'pty-shell',
        projectPath: PROJECT,
        taskNumber: 15,
        hookType: 'start',
        command: 'claude "$OUIJIT_TASK_DESCRIPTION"',
        outsideSandbox: false,
        run: startHook,
      });
    });
    await waitFor(() => expect(count()?.textContent).toBe('5 waiting'));

    openList();
    expect(list()).toBeTruthy();
    const login = screen.getByRole('region', { name: 'Rate limit login' });
    expect(
      within(login)
        .getAllByTestId('waiting-command')
        .map((c) => c.textContent),
    ).toEqual(['npm run migrate', 'npm run lint', 'gh release create v2']);
    expect(within(screen.getByRole('region', { name: 'Scratch' })).getAllByTestId('waiting-row')).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Write docs' })).getAllByTestId('waiting-row')).toHaveLength(1);
    within(rowOf('npm run migrate')).getByText('Needs the prod database url');
    within(rowOf('npm run migrate')).getByText('Command');
    within(rowOf('claude "$OUIJIT_TASK_DESCRIPTION"')).getByText('Start hook');
    within(rowOf('claude "$OUIJIT_TASK_DESCRIPTION"')).getByText('Starts an agent');
    within(rowOf('gh release create v2')).getByText('Outside the sandbox');

    // Two selected: the confirm step lists both, flagging the hook that starts an agent, and nothing runs before it.
    fireEvent.click(screen.getByLabelText('Select: npm run migrate'));
    fireEvent.click(screen.getByLabelText('Select: claude "$OUIJIT_TASK_DESCRIPTION"'));
    screen.getByText('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Run selected' }));
    expect(screen.getAllByTestId('confirm-row').map((r) => r.textContent)).toEqual([
      'Commandnpm run migrate',
      'Start hookStarts an agentclaude "$OUIJIT_TASK_DESCRIPTION"',
    ]);
    expect(startRunner).not.toHaveBeenCalled();
    finish([{ id: 'panel-1', status: 'running' }]);
    fireEvent.click(screen.getByTestId('confirm-run'));
    expect(startHook).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(rowOf('npm run migrate')).getByText('Running…')).toBeTruthy());
    expect(startRunner).toHaveBeenCalledWith('pty-agent', expect.objectContaining({ command: 'npm run migrate' }));
    expect(screen.queryByText('claude "$OUIJIT_TASK_DESCRIPTION"')).toBeNull();

    // A run that succeeds leaves; its --wait caller gets the output.
    finish([{ id: 'panel-1', status: 'success', exitCode: 0 }]);
    await waitFor(() =>
      expect(reply(migrate)).toEqual({
        ok: true,
        answer: {
          status: 'exited',
          panelId: 'panel-1',
          exitCode: 0,
          output: expect.stringContaining('migrated 3 tables'),
        },
      }),
    );
    expect(screen.queryByText('npm run migrate')).toBeNull();

    // A run that fails stays, marked, with its runner a click away.
    finish([
      { id: 'panel-1', status: 'success', exitCode: 0 },
      { id: 'panel-2', status: 'running' },
    ]);
    fireEvent.click(within(rowOf('npm run lint')).getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(startRunner).toHaveBeenCalledTimes(2));
    finish([
      { id: 'panel-1', status: 'success', exitCode: 0 },
      { id: 'panel-2', status: 'error', exitCode: 1 },
    ]);
    await waitFor(() => within(rowOf('npm run lint')).getByText('Failed, exit 1'));
    expect(reply(lint)).toEqual({ ok: true, answer: expect.objectContaining({ status: 'exited', exitCode: 1 }) });
    fireEvent.click(within(rowOf('npm run lint')).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('npm run lint')).toBeNull();
    expect(count()?.textContent).toBe('2 waiting');
  });

  test('declines a group without touching the rest, and closing it, selection and all, decides nothing', async () => {
    renderQueue();
    const { ask, reply } = cliAsks();
    const mine = [ask('npm run e2e'), ask('npm run bench', { from: 'pty-other' })];
    const scratch = ask('rm -rf node_modules', { from: 'pty-shell' });
    await waitFor(() => expect(count()?.textContent).toBe('3 waiting'));

    openList();
    const login = screen.getByRole('region', { name: 'Rate limit login' });
    fireEvent.click(within(login).getByRole('button', { name: 'Decline all' }));
    await waitFor(() =>
      expect(mine.map(reply)).toEqual([0, 1].map(() => ({ ok: true, answer: { status: 'declined' } }))),
    );
    expect(screen.queryByRole('region', { name: 'Rate limit login' })).toBeNull();
    expect(reply(scratch)).toBeUndefined();

    fireEvent.click(screen.getByLabelText('Select all in Scratch'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(list()).toBeNull());
    expect(reply(scratch)).toBeUndefined();
    expect(startRunner).not.toHaveBeenCalled();

    openList();
    expect((screen.getByLabelText('Select: rm -rf node_modules') as HTMLInputElement).checked).toBe(false);
  });

  test('an ask from the terminal in front opens on its own only while nothing else waits, and never leads to another', async () => {
    vi.mocked(startRunner).mockResolvedValue('panel-r');
    const finish = runners({});
    useAppStore.setState({ selection: { kind: 'terminal', stack: `task:14:${PROJECT}`, projectPath: PROJECT } });
    renderQueue();
    const { ask, reply } = cliAsks();

    ask('./scripts/sign.sh --all', {
      message: 'Needs the keychain',
      file: { path: 'scripts/sign.sh', contents: 'codesign --deep "$@"' },
      runCommand: '/data/ask-runs/1/sign.sh --all',
    });
    expect(codeIn(await screen.findByTestId('ask-command'))).toBe('./scripts/sign.sh --all');
    expect(codeIn(screen.getByTestId('ask-file'))).toBe('codesign --deep "$@"');
    screen.getByText('Needs the keychain');

    // Closed, it is still waiting, and listed.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('ask-command')).toBeNull());
    openList();
    rowOf('./scripts/sign.sh --all');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(list()).toBeNull());

    // With something else already waiting, a new one from the front waits in the list.
    const behind = ask('npm run e2e', { from: 'pty-shell' });
    const publish = ask('npm publish');
    await waitFor(() => expect(count()?.textContent).toBe('3 waiting'));
    expect(screen.queryByTestId('ask-command')).toBeNull();

    // One open on its own gives way to the list when another arrives over it.
    act(() => useWaitingStore.getState().openAsk(useWaitingStore.getState().items[0].id));
    await screen.findByTestId('ask-command');
    ask('npm run deploy');
    await waitFor(() => expect(list()).toBeTruthy());
    expect(screen.queryByTestId('ask-command')).toBeNull();
    expect(screen.getAllByTestId('waiting-row')).toHaveLength(4);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(list()).toBeNull());

    // Answered on its own with others waiting, it goes on to the list, not to the next one.
    act(() => useWaitingStore.getState().openAsk(useWaitingStore.getState().items[0].id));
    finish([{ id: 'panel-r', status: 'running' }]);
    fireEvent.click(await screen.findByTestId('ask-run'));
    await waitFor(() =>
      // The copy that was read runs, not the file the agent can still edit, and nothing waits on a pager.
      expect(startRunner).toHaveBeenCalledWith('pty-agent', {
        name: './scripts/sign.sh --all',
        command: '/data/ask-runs/1/sign.sh --all',
        env: expect.objectContaining({ PAGER: 'cat', GH_PAGER: 'cat', GIT_PAGER: 'cat' }),
      }),
    );
    await waitFor(() => expect(list()).toBeTruthy());
    expect(screen.queryByTestId('ask-command')).toBeNull();
    expect(reply(publish)).toBeUndefined();

    // An ask from a terminal that closes is declined.
    act(() =>
      useTerminalStore.setState((s) => {
        const { 'pty-shell': _, ...rest } = s.displayStates;
        return { displayStates: rest };
      }),
    );
    await waitFor(() => expect(reply(behind)).toEqual({ ok: true, answer: { status: 'declined' } }));
  });
});
