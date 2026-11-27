import { test, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { Sidebar } from '../../components/SidebarReact';
import { MainView } from '../../components/MainView';
import { TitleBar } from '../../components/TitleBarReact';
import { useBackShortcuts } from '../../components/BackButton';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { usePanelStore } from '../../stores/panelStore';
import { installNavigationHistory } from '../../stores/navigationHistory';
import { DEFAULT_EXPERIMENTAL_FLAGS, useExperimentalStore } from '../../stores/experimentalStore';
import { NO_CAPABILITIES, type ChatNode, type ChatSessionInfo, type ChatSnapshot } from '../../chat/model';

// xterm cannot construct under jsdom. Chat's panel host is one of these, so the
// fake keeps what that reads: its panels, and fitting it to the page.
vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {
    panels = [];
    activePanelId = null;
    fit() {}
    getActivePanel() {
      return undefined;
    }
  },
  resolveTerminalLabel: () => '',
  refreshTerminalsGitStatus: vi.fn(),
  refreshTerminalGitStatus: vi.fn(),
  hydrateTerminalFont: vi.fn(),
}));

const CHAT_DIR = '/Users/test/Library/Application Support/Ouijit/chat';

function snapshot(id: string, reply: string): ChatSnapshot {
  const info: ChatSessionInfo = {
    id,
    role: 'home',
    label: null,
    agent: 'claude',
    agentSessionId: 'abc',
    projectPath: CHAT_DIR,
    cwd: CHAT_DIR,
    worktreePath: null,
    sandbox: null,
    taskId: null,
    status: 'idle',
    capabilities: NO_CAPABILITIES,
    models: [],
    efforts: [],
    modes: [],
    commands: [],
  } as unknown as ChatSessionInfo;
  const nodes: ChatNode[] = [
    { kind: 'user_message', id: `${id}-u`, parentId: null, createdAt: 1, text: 'Where is it?', attachments: [] },
    { kind: 'assistant_message', id: `${id}-a`, parentId: null, createdAt: 2, text: reply, status: 'completed' },
  ] as ChatNode[];
  return { info, nodes, seq: nodes.length };
}

function App() {
  useBackShortcuts();
  return (
    <>
      <TitleBar />
      <Sidebar onAddProject={() => {}} onCloneSelect={() => {}} />
      <MainView />
    </>
  );
}

/** As the user does it: a press, then the click. */
function press(element: Element): void {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
}

/** The link in a reply, once its highlighted render has replaced the plain one it first shows. */
async function replyLink(): Promise<HTMLElement> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  return screen.findByRole('link', { name: 'the pull request' });
}

test('Back from a pull request a Chat link opened lands on that same conversation, and goes only where is still there', async () => {
  const first = snapshot('home-1', 'Nothing yet.');
  const second = snapshot('home-2', 'It is up as [the pull request](ouijit://Alpha/pulls/357).');
  vi.mocked(window.api.homeChat.switch).mockImplementation(async (id) => (id === 'home-1' ? first : second));
  vi.mocked(window.api.chat.snapshot).mockImplementation(async (id) => (id === 'home-1' ? first : second));
  useAppStore.setState({
    projects: [{ path: '/code/alpha', name: 'Alpha' }],
    taskCacheByProject: {},
    viewByProject: {},
  });
  useExperimentalStore.setState({ flagsByProject: { '/code/alpha': { ...DEFAULT_EXPERIMENTAL_FLAGS, github: true } } });
  useHomeChatStore.getState().set({
    currentId: 'home-1',
    chats: [
      { id: 'home-1', title: 'Plan the week', createdAt: '2026-11-10T00:00:00Z', activeAt: 2 },
      { id: 'home-2', title: 'Ship the panel', createdAt: '2026-11-09T00:00:00Z', activeAt: 1 },
    ],
    owners: {},
  });
  useHomeChatStore.getState().setEnabled(true);
  act(() => {
    useChatStore.getState().adopt(first);
    useChatStore.getState().adopt(second);
  });
  useAppStore.getState().select({ kind: 'chat' });
  installNavigationHistory();
  render(<App />);
  // Nowhere has been left yet.
  expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull();

  // Another conversation from the sidebar, then a link in its reply to a pull request.
  press(await screen.findByText('Ship the panel'));
  press(await replyLink());
  await waitFor(() =>
    expect(useAppStore.getState().selection).toEqual({
      kind: 'page',
      projectPath: '/code/alpha',
      page: 'pull-requests',
    }),
  );
  expect(usePanelStore.getState().open).toEqual({ source: 'github-pr', number: 357 });

  // Back names where it goes, and goes there: the conversation the link was in.
  press(await screen.findByRole('button', { name: 'Back to Chat' }));
  await waitFor(() => expect(useAppStore.getState().selection).toEqual({ kind: 'chat' }));
  expect(useHomeChatStore.getState().currentId).toBe('home-2');
  expect(await screen.findByRole('link', { name: 'the pull request' })).toBeTruthy();

  // ⌘[ goes back too, here to the conversation before it.
  fireEvent.keyDown(document, { key: '[', metaKey: true, ctrlKey: true });
  await waitFor(() => expect(useHomeChatStore.getState().currentId).toBe('home-1'));
  expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull();

  // A conversation deleted since is nowhere to go back to.
  press(await screen.findByText('Ship the panel'));
  press(await replyLink());
  expect(await screen.findByRole('button', { name: 'Back to Chat' })).toBeTruthy();
  act(() =>
    useHomeChatStore.getState().set({
      currentId: 'home-3',
      chats: [{ id: 'home-3', title: 'Fresh', createdAt: '2026-11-11T00:00:00Z', activeAt: 3 }],
      owners: {},
    }),
  );
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull());
});
