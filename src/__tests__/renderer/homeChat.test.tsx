import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Sidebar } from '../../components/SidebarReact';
import { MainView } from '../../components/MainView';
import { TitleBar } from '../../components/TitleBarReact';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { HOME_CHAT_ID, HOME_CHAT_SETTING_KEYS } from '../../chat/preferences';
import { NO_CAPABILITIES, type ChatNode, type ChatSessionInfo, type ChatSnapshot } from '../../chat/model';

vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  resolveTerminalLabel: () => '',
  refreshTerminalsGitStatus: vi.fn(),
  refreshTerminalGitStatus: vi.fn(),
  hydrateTerminalFont: vi.fn(),
}));

const INFO: ChatSessionInfo = {
  id: HOME_CHAT_ID,
  label: 'Chat',
  agent: 'claude',
  agentSessionId: 'abc',
  projectPath: '/Users/test/Library/Application Support/Ouijit/chat',
  cwd: '/Users/test/Library/Application Support/Ouijit/chat',
  worktreePath: null,
  sandbox: 'nono',
  taskId: null,
  status: 'idle',
  capabilities: NO_CAPABILITIES,
  models: [],
  efforts: [],
  modes: [],
  commands: [],
};

let at = 1_000_000;
const node = (partial: Partial<ChatNode> & { kind: ChatNode['kind']; id: string }): ChatNode =>
  ({ parentId: null, createdAt: (at += 5_000), ...partial }) as ChatNode;
const tool = (id: string, tool: string, title: string, status = 'completed', files: unknown[] = []): ChatNode =>
  node({ kind: 'tool_call', id, tool, title, status, files, output: '' } as Partial<ChatNode> & {
    kind: 'tool_call';
    id: string;
  });

function transcript(): ChatNode[] {
  return [
    node({ kind: 'user_message', id: 'u1', text: 'Ship the settings page.', attachments: [], delivery: 'prompt' }),
    node({ kind: 'assistant_message', id: 'a1', text: 'Three tasks. Starting the first.', status: 'completed' }),
    tool('t1', 'command', 'ouijit task create "Settings storage"'),
    tool('t2', 'command', 'ouijit task start 12'),
    tool('t3', 'edit', 'Write notes.md', 'completed', [{ path: '/chat/notes.md' }]),
    node({
      kind: 'user_message',
      id: 'w1',
      text: 'Ouijit: Settings storage (T-12 in Alpha), chat pty-12, finished its turn.',
      attachments: [],
      delivery: 'prompt',
      wake: true,
    }),
    node({ kind: 'assistant_message', id: 'a2', text: 'Reading what it did.', status: 'completed' }),
    tool('t4', 'read', 'ouijit chat read pty-12', 'running'),
  ];
}

function adopt(nodes: ChatNode[], info: Partial<ChatSessionInfo> = {}): void {
  const snapshot: ChatSnapshot = { info: { ...INFO, ...info }, nodes, seq: nodes.length };
  act(() => useChatStore.getState().adopt(snapshot));
}

function App() {
  return (
    <>
      <TitleBar />
      <Sidebar onAddProject={() => {}} onCloneSelect={() => {}} />
      <MainView />
    </>
  );
}

beforeEach(() => {
  at = 1_000_000;
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
  useUIStore.setState(useUIStore.getInitialState(), true);
  useChatStore.setState({ sessions: {}, setup: {}, drafts: {} });
  useAppStore.setState({
    projects: [{ path: '/code/alpha', name: 'Alpha' }],
    taskCacheByProject: {},
    viewByProject: {},
  });
  useAppStore.getState().select({ kind: 'none' });
  vi.mocked(window.api.globalSettings.get).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.globalSettings.set).mockClear();
  vi.mocked(window.api.homeChat.restart).mockClear();
});

describe('Chat', () => {
  test('sits above the projects, opens as a folded transcript, and has settings of its own', async () => {
    adopt(transcript(), { status: 'running' });
    render(<App />);

    // The sidebar entry carries the chat's status, and opens it.
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    const entry = within(sidebar).getByRole('button', { name: /Chat/ });
    expect(entry.compareDocumentPosition(within(sidebar).getByRole('region', { name: 'Projects' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(entry.querySelector('[data-status="thinking"]')).toBeTruthy();
    fireEvent.click(entry);
    expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'chat' });
    expect(entry.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Ship the settings page.')).toBeTruthy();

    // Work between two things said is one line, closed; what Ouijit sent is a plain line, not a bubble.
    const fold = screen.getByRole('button', { name: /Ran 2 commands, edited 1 file/ });
    expect(fold.textContent).toBe('Ran 2 commands, edited 1 file10s');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('ouijit task start 12')).toBeNull();
    fireEvent.click(fold);
    expect(screen.getByText('ouijit task start 12')).toBeTruthy();
    const wake = screen.getByText(/finished its turn/);
    expect(wake.className).not.toContain('rounded');

    // The stretch still running stays open, and closes once it is done.
    expect(screen.getByText('ouijit chat read pty-12')).toBeTruthy();
    const running = screen.getByRole('button', { name: /Read 1 file/ });
    expect(running.getAttribute('aria-expanded')).toBe('true');
    adopt(transcript().map((n) => (n.id === 't4' ? { ...n, status: 'completed' } : n)) as ChatNode[], {
      status: 'idle',
    });
    expect(screen.getByRole('button', { name: /Read 1 file/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('ouijit chat read pty-12')).toBeNull();

    // The gear opens Chat's settings, where a change of where it runs restarts the agent.
    fireEvent.click(screen.getByRole('button', { name: 'Chat settings' }));
    expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'settings' });
    expect(await screen.findByRole('heading', { name: 'Chat settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sandbox', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Host' }));
    expect(window.api.globalSettings.set).toHaveBeenCalledWith(HOME_CHAT_SETTING_KEYS.sandbox, 'none');
    await act(async () => {});
    expect(window.api.homeChat.restart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'A hook fails' }));
    expect(window.api.globalSettings.set).toHaveBeenCalledWith(
      HOME_CHAT_SETTING_KEYS.wake,
      JSON.stringify({ turnEnded: true, asked: true, taskMoved: true, hookFailed: false }),
    );
    expect(window.api.homeChat.restart).toHaveBeenCalledTimes(1);

    // Escape leaves settings for the chat.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'chat' });
  });
});
