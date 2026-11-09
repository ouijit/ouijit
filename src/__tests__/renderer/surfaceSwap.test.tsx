import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

import { TerminalBody } from '../../components/terminal/TerminalBody';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { NO_CAPABILITIES, type ChatSessionInfo } from '../../chat/model';

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
  test('keeps the view being left until the other has something to show, then fades it in', async () => {
    render(<TerminalBody ptyId={ID} projectPath="/p" />);
    expect(screen.getByText('SCREEN')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Terminal' }).getAttribute('aria-checked')).toBe('true');

    // The choice shows at once, and says what it is doing while nothing is waiting.
    display({ switching: 'chat' });
    expect(screen.getByRole('radio', { name: 'Chat' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Opening chat…')).toBeTruthy();

    // The chat view is in place but see-through; the screen stays up, dimmed, until it has content.
    display({ surface: 'chat' });
    const loading = screen.getByText('Loading chat…');
    expect(layerOf(loading).style.opacity).toBe('0');
    expect(layerOf(screen.getByText('SCREEN')).style.opacity).toBe('0.55');

    chat({ status: 'starting' });
    expect(layerOf(screen.getByText('Starting Claude Code…')).style.opacity).toBe('0');
    chat({ status: 'idle' });
    expect(layerOf(screen.getByText('Claude Code is ready.')).style.opacity).toBe('1');
    await waitFor(() => expect(screen.queryByText('SCREEN')).toBeNull());
    display({ switching: null });

    // Back the other way: a turn in flight is waited on, and can be cut short.
    chat({ status: 'running' });
    display({ switching: 'terminal' });
    expect(screen.getByText('Switching when this turn ends')).toBeTruthy();
    expect(screen.getByText('Stop now')).toBeTruthy();
    chat({ status: 'idle' });
    expect(screen.getByText('Opening terminal…')).toBeTruthy();

    // The cleared screen stays see-through until the new PTY draws.
    display({ blank: true });
    display({ surface: 'terminal' });
    expect(layerOf(screen.getByText('SCREEN')).style.opacity).toBe('0');
    expect(layerOf(screen.getByText('Claude Code is ready.')).style.opacity).toBe('0.55');
    display({ blank: false });
    expect(layerOf(screen.getByText('SCREEN')).style.opacity).toBe('1');
    await waitFor(() => expect(screen.queryByText('Claude Code is ready.')).toBeNull());
  });
});
