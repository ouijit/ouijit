import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

import { TerminalBody } from '../../components/terminal/TerminalBody';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { NO_CAPABILITIES, type ChatNode, type ChatSessionInfo } from '../../chat/model';
import { switchToChat } from '../../components/chat/chatActions';

// xterm cannot construct under jsdom; the body only reparents its element.
vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  resolveTerminalLabel: () => '',
}));

const ID = 'pty-swap';

const INFO: ChatSessionInfo = {
  id: ID,
  agent: 'claude',
  agentSessionId: 'abc',
  projectPath: '/p',
  cwd: '/p',
  worktreePath: null,
  sandbox: null,
  taskId: 1,
  status: 'starting',
  capabilities: NO_CAPABILITIES,
  models: [],
  efforts: [],
  modes: [],
  commands: [],
};

function layerOf(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>('[data-card-main] > div[style*="opacity"]')!;
}

function display(patch: Partial<TerminalDisplayState>): void {
  act(() => useTerminalStore.getState().updateDisplay(ID, patch));
}

function chat(info: Partial<ChatSessionInfo>): void {
  act(() => useChatStore.getState().adopt({ info: { ...INFO, ...info }, nodes: [], seq: 1 }));
}

beforeEach(() => {
  useTerminalStore.setState({ displayStates: {}, order: [], terminalsByProject: {} });
  useChatStore.setState({ sessions: {} });
  const viewport = document.createElement('div');
  viewport.textContent = 'SCREEN';
  terminalInstances.set(ID, {
    getViewportElement: () => viewport,
    reattach() {},
    detach() {},
    fit() {},
    getActivePanel: () => null,
    runnerChildren: new Map(),
    panelSplitRatio: 0.5,
    covered: false,
    xterm: { focus() {} },
  } as never);
  useTerminalStore.getState().addTerminal('/p', ID, { label: 'Ship it', surface: 'terminal', chatAgent: 'claude' });
});

describe('switching a card between terminal and chat', () => {
  test('shows the other view as soon as it can, while its process catches up behind it', async () => {
    render(<TerminalBody ptyId={ID} projectPath="/p" />);
    expect(screen.getByText('SCREEN')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Terminal' }).getAttribute('aria-checked')).toBe('true');

    // The choice shows at once, and breathes until the other view is up.
    const group = () => screen.getByRole('radiogroup', { name: 'View' });
    expect(group().dataset.pending).toBeUndefined();
    display({ switching: 'chat' });
    expect(screen.getByRole('radio', { name: 'Chat' }).getAttribute('aria-checked')).toBe('true');
    expect(group().dataset.pending).toBe('true');

    // Until there is a session to show, the screen stays up; once there is, even one still starting, the chat shows.
    display({ surface: 'chat' });
    expect(layerOf(screen.getByText('Loading chat…')).style.opacity).toBe('0');
    expect(layerOf(screen.getByText('SCREEN')).style.opacity).toBe('1');
    chat({ status: 'starting' });
    await waitFor(() => expect(layerOf(screen.getByText('Starting Claude Code…')).style.opacity).toBe('1'));
    chat({ status: 'idle' });
    expect(layerOf(screen.getByText('Claude Code is ready.')).style.opacity).toBe('1');
    await waitFor(() => expect(screen.queryByText('SCREEN')).toBeNull());
    display({ switching: null });
    expect(group().dataset.pending).toBeUndefined();

    // Back the other way: a turn in flight is waited on, and can be cut short.
    chat({ status: 'running' });
    display({ switching: 'terminal' });
    expect(screen.getByText('Switching when this turn ends')).toBeTruthy();
    expect(screen.getByText('Stop now')).toBeTruthy();
    chat({ status: 'idle' });
    expect(screen.queryByText('Switching when this turn ends')).toBeNull();
    expect(group().dataset.pending).toBe('true');

    // The chat's agent stopping is the handoff, not something the view announces.
    chat({ status: 'exited' });
    expect(screen.queryByText('Claude Code stopped')).toBeNull();
    expect(screen.queryByText('Restart')).toBeNull();

    // The terminal shows at once, saying it is resuming until the new PTY draws.
    display({ blank: true });
    display({ surface: 'terminal' });
    display({ switching: null });
    // A cut: the chat is gone as the terminal shows, so nothing of it shows through the blank screen.
    expect(layerOf(screen.getByText('SCREEN')).style.opacity).toBe('1');
    expect(screen.queryByText('Claude Code is ready.')).toBeNull();
    expect(screen.getByText('Resuming…')).toBeTruthy();
    expect(group().dataset.pending).toBe('true');
    display({ blank: false });
    expect(screen.queryByText('Resuming…')).toBeNull();
    expect(group().dataset.pending).toBeUndefined();
  });

  test("going back to chat shows the stored conversation at once, before the chat's agent is up", async () => {
    const said: ChatNode = {
      kind: 'assistant_message',
      id: 'a1',
      parentId: null,
      createdAt: 1,
      text: 'Already said in chat.',
      status: 'completed',
    };
    vi.mocked(window.api.chat.snapshot).mockResolvedValue({
      info: { ...INFO, status: 'exited' },
      nodes: [said],
      seq: 4,
    });
    let agentUp: (value: unknown) => void = () => {};
    vi.mocked(window.api.chat.start).mockImplementation(() => new Promise((resolve) => (agentUp = resolve)) as never);
    const term = {
      surface: 'terminal',
      chatAgent: 'claude',
      projectPath: '/p',
      worktreePath: null,
      taskId: 1,
      sandboxProvider: undefined,
      pushDisplayState: (patch: Partial<TerminalDisplayState>) => display(patch),
      releasePty: vi.fn(async () => {}),
      setSurface(surface: 'terminal' | 'chat') {
        this.surface = surface;
        display({ surface });
      },
      focus() {},
    };
    terminalInstances.set(ID, { ...terminalInstances.get(ID)!, ...term } as never);
    render(<TerminalBody ptyId={ID} projectPath="/p" />);

    const switching = switchToChat(ID);
    await waitFor(() => expect(screen.getByText('Already said in chat.')).toBeTruthy());
    await waitFor(() => expect(layerOf(screen.getByText('Already said in chat.')).style.opacity).toBe('1'));
    expect(window.api.chat.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      agentUp({ info: { ...INFO, status: 'idle' }, nodes: [said], seq: 5 });
      await switching;
    });
    expect(useChatStore.getState().sessions[ID].info.status).toBe('idle');
  });
});
