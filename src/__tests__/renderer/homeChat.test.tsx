import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Sidebar } from '../../components/SidebarReact';
import { MainView } from '../../components/MainView';
import { TitleBar } from '../../components/TitleBarReact';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { HOME_CHAT_SETTING_KEYS, taskKey, type ChatDecision } from '../../chat/preferences';
import { listenForChatDecisions } from '../../services/homeChatDecisions';
import { ChatSettingsSection } from '../../components/chat/ChatSettingsSection';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { useWaitingStore } from '../../stores/waitingStore';
import { NO_CAPABILITIES, type ChatNode, type ChatSessionInfo, type ChatSnapshot } from '../../chat/model';

vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  resolveTerminalLabel: () => '',
  refreshTerminalsGitStatus: vi.fn(),
  refreshTerminalGitStatus: vi.fn(),
  hydrateTerminalFont: vi.fn(),
}));

const CURRENT = 'home-1';

const INFO: ChatSessionInfo = {
  id: CURRENT,
  role: 'home',
  label: 'Ship the settings page.',
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
    node({ kind: 'reasoning', id: 'r0', text: '', status: 'completed' }),
    tool('t1', 'command', 'ouijit task create "Settings storage"'),
    tool('t2', 'command', 'ouijit task start 12'),
    node({ kind: 'reasoning', id: 'r1', text: 'Started. Writing the plan down next.', status: 'completed' }),
    node({ kind: 'assistant_message', id: 'a1', text: 'Starting the first.', status: 'completed' }),
    tool('t3', 'edit', 'Write notes.md', 'completed', [{ path: '/chat/notes.md' }]),
    node({
      kind: 'assistant_message',
      id: 'a1b',
      text: '## Board\n\nSettings storage is running.',
      status: 'completed',
    }),
    node({
      kind: 'user_message',
      id: 'w1',
      text: 'Ouijit: Settings storage (T-12 in Alpha), chat pty-12, finished its turn.',
      attachments: [],
      delivery: 'prompt',
      wake: true,
      notes: [
        { kind: 'decision', text: 'You allowed Settings storage: Write migration' },
        { kind: 'event', text: 'Settings storage finished its turn' },
      ],
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
  useWaitingStore.setState({ items: [], open: false, selected: null });
  useHomeChatStore.getState().set({
    currentId: CURRENT,
    chats: [
      { id: CURRENT, title: 'Ship the settings page.', createdAt: '2026-11-10T00:00:00Z' },
      { id: 'home-2', title: 'Keychain recovery review', createdAt: '2026-11-09T00:00:00Z' },
    ],
    owners: {},
  });
  useHomeChatStore.getState().setEnabled(true);
  vi.mocked(window.api.homeChat.create).mockClear();
  vi.mocked(window.api.homeChat.switch).mockClear();
  vi.mocked(window.api.homeChat.rename).mockClear();
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

function approvalWake(
  n: number,
  command: string,
  answered: boolean,
  reply = answered ? 'Approved.' : 'This one deletes the build folder, so it is yours to decide.',
): ChatNode[] {
  const options = [
    { id: 'allow', label: 'Allow', kind: 'allow_once' as const },
    { id: 'deny', label: 'Deny', kind: 'reject_once' as const },
  ];
  const request = node({
    kind: 'request',
    id: `req-${n}`,
    request: 'approval',
    title: command,
    options,
    questions: [],
    status: answered ? 'answered' : 'pending',
    ...(answered && { answer: { kind: 'option', optionId: 'allow' }, byChat: true }),
  }) as Extract<ChatNode, { kind: 'request' }>;
  return [
    node({
      kind: 'user_message',
      id: `wake-${n}`,
      text: `Ouijit: Chat (T-605 in ouijit), chat pty-605, is waiting on an approval: ${command} (request req-${n}).`,
      attachments: [],
      delivery: 'prompt',
      wake: true,
      notes: [
        {
          kind: 'event',
          text: 'Chat asked to run a command',
          request: { session: 'pty-605', name: 'Chat (T-605)', node: request, command },
        },
      ],
    }),
    tool(`answer-${n}`, 'command', `ouijit chat answer pty-605 req-${n} --option allow`),
    node({
      kind: 'assistant_message',
      id: `reply-${n}`,
      text: reply,
      status: 'completed',
    }),
  ];
}

describe('Chat', () => {
  test("shows a worker's requests as a line each, folds the ones it approved, and leaves the rest to you", async () => {
    vi.mocked(window.api.chat.answer).mockClear();
    adopt([
      ...approvalWake(1, 'npx tsc --noEmit -p .', true),
      // Chat's own run of the answer, which you allowed, is part of its routine.
      node({
        kind: 'request',
        id: 'own-1',
        request: 'approval',
        title: 'ouijit chat answer pty-605 req-1 --option allow',
        options: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }],
        questions: [],
        status: 'answered',
        answer: { kind: 'option', optionId: 'allow' },
      }),
      ...approvalWake(2, "python3 - <<'EOF'\nprint('a')\nEOF", true),
      ...approvalWake(3, 'npm run check', false, 'Approved.'),
      ...approvalWake(4, 'rm -rf build', false),
    ]);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Ship the settings page.' }));

    // A wake folds in as Chat's answer to it arrives.
    expect(screen.getByRole('button', { name: 'Approved 2 commands for Chat (T-605)' })).toBeTruthy();
    const session = useChatStore.getState().sessions[CURRENT];
    const wake = session.nodes.find((n) => n.id === 'wake-3') as Extract<ChatNode, { kind: 'user_message' }>;
    const [note] = wake.notes!;
    act(() =>
      useChatStore.getState().apply(CURRENT, {
        seq: session.seq + 1,
        event: {
          type: 'node',
          node: {
            ...wake,
            notes: [
              {
                ...note,
                request: {
                  ...note.request!,
                  node: {
                    ...note.request!.node,
                    status: 'answered',
                    answer: { kind: 'option', optionId: 'allow' },
                    byChat: true,
                  },
                },
              },
            ],
          },
        },
      }),
    );

    // Approvals Chat took care of are one line, opening to a line each, each opening to its command.
    expect(screen.queryByText('Approved.')).toBeNull();
    expect(screen.queryByText(/print\('a'\)/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approved 3 commands for Chat (T-605)' }));
    const lines = screen.getAllByRole('button', { name: /^Chat \(T-605\) wants to run .*Allowed by Chat$/ });
    expect(lines.map((line) => line.textContent)).toEqual([
      'Chat (T-605) wants to run npx tsc --noEmit -p .Allowed by Chat',
      "Chat (T-605) wants to run python3 - <<'EOF'Allowed by Chat",
      'Chat (T-605) wants to run npm run checkAllowed by Chat',
    ]);
    fireEvent.click(lines[1]);
    expect(screen.getByText(/print\('a'\)/).closest('pre')).toBeTruthy();

    // What Chat left waiting is a card, the command as code, answered on the worker's chat.
    expect(screen.getByText('This one deletes the build folder, so it is yours to decide.')).toBeTruthy();
    expect(screen.getByText('Chat asked to run a command')).toBeTruthy();
    expect(screen.getByText('rm -rf build').closest('pre')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(window.api.chat.answer).toHaveBeenCalledWith('pty-605', 'req-4', { kind: 'option', optionId: 'allow' });
  });

  test("says a command that only works in the agent's own terminal can't run here, with nothing to click", () => {
    adopt(transcript().map((n) => (n.id === 't4' ? { ...n, status: 'completed' } : n)) as ChatNode[], {
      status: 'idle',
    });
    render(<App />);
    act(() => useAppStore.getState().select({ kind: 'chat', page: 'chat' }));
    const composer = screen.getByLabelText('Message');
    fireEvent.change(composer, { target: { value: '/login' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByText(/only works in Claude Code's own terminal, which Chat doesn't have/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open in terminal' })).toBeNull();
    expect(window.api.chat.prompt).not.toHaveBeenCalledWith(
      CURRENT,
      expect.objectContaining({ text: '/login' }),
      'auto',
    );
  });

  test('is off until turned on in Settings: no group, no page, and Chat never starts', async () => {
    useHomeChatStore.getState().setEnabled(false);
    vi.mocked(window.api.homeChat.start).mockClear();
    render(<App />);
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    expect(sidebar.querySelector('[data-group="home-chat"]')).toBeNull();
    act(() => useAppStore.getState().select({ kind: 'chat', page: 'chat' }));
    expect(document.querySelector('.chat-turns')).toBeNull();

    render(<ChatSettingsSection />);
    const toggle = await screen.findByRole('switch', { name: /^Chat/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Open tasks in')).toBeNull();
    fireEvent.click(toggle);
    expect(window.api.globalSettings.set).toHaveBeenCalledWith('chat:enabled', '1');
    await waitFor(() => expect(window.api.homeChat.start).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Open tasks in')).toBeTruthy();
    expect(sidebar.querySelector('[data-group="home-chat"]')).not.toBeNull();
  });

  test('sits above the projects, opens as a folded transcript, and has settings of its own', async () => {
    adopt(transcript(), { status: 'running' });
    render(<App />);

    // The group sits above the projects: a row per conversation, with no status: only the open one runs.
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    const group = sidebar.querySelector<HTMLElement>('[data-group="home-chat"]')!;
    expect(group.compareDocumentPosition(within(sidebar).getByRole('region', { name: 'Projects' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const current = within(group).getByRole('button', { name: 'Ship the settings page.' });
    expect(current.closest('[data-sidebar-row]')!.querySelector('[data-status]')).toBeNull();
    fireEvent.click(current);
    expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'chat' });
    expect(window.api.homeChat.switch).not.toHaveBeenCalled();
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(within(screen.getByRole('banner')).getByText('Ship the settings page.')).toBeTruthy();

    // A finished turn is one closed line for its work, then what it said last; an empty thought counts for nothing.
    const fold = screen.getByRole('button', { name: /Ran 2 commands/ });
    expect(fold.textContent).toBe('Ran 2 commands, edited 1 file, said 1 thing · 20s');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Starting the first.')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Board' })).toBeTruthy();
    expect(screen.getByText('Settings storage is running.')).toBeTruthy();
    fireEvent.click(fold);
    expect(screen.getByText('ouijit task start 12')).toBeTruthy();
    expect(screen.getByText('Started. Writing the plan down next.')).toBeTruthy();
    expect(screen.getByText('Starting the first.')).toBeTruthy();

    // A wake is what you did, a line each, and a caption for what happened.
    expect(screen.getByText('You allowed Settings storage: Write migration')).toBeTruthy();
    expect(screen.getByText('Settings storage finished its turn')).toBeTruthy();
    expect(screen.queryByText(/chat pty-12, finished its turn/)).toBeNull();

    // The turn running is one line of what it is doing now: nothing of its work, not even what it has said.
    expect(screen.getByRole('status', { name: 'Working' }).textContent).toMatch(/^ouijit chat read pty-12 · /);
    expect(screen.queryByText('Reading what it did.')).toBeNull();
    adopt(transcript().map((n) => (n.id === 't4' ? { ...n, status: 'completed' } : n)) as ChatNode[], {
      status: 'idle',
    });
    expect(screen.queryByRole('status', { name: 'Working' })).toBeNull();
    expect(screen.getByRole('button', { name: /Read 1 file/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Reading what it did.')).toBeTruthy();

    // What it says at length streams in where it says it, and stays once it moves on; a remark only names the step.
    const long = node({
      kind: 'assistant_message',
      id: 'a3',
      text: 'It wrote the migration.\n\n- Adds a settings table\n- Backfills from the old file',
      status: 'running',
    });
    adopt([...transcript(), long], { status: 'running' });
    expect(await screen.findByText('Adds a settings table', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Working' })).toBeNull();
    adopt(
      [
        ...transcript(),
        { ...long, status: 'completed' } as ChatNode,
        { ...tool('t5', 'command', 'git log'), command: 'git log' } as ChatNode,
      ],
      {
        status: 'running',
      },
    );
    expect(screen.getByText('Adds a settings table')).toBeTruthy();
    // The step after it waits until it has been revealed.
    expect((await screen.findByRole('status', { name: 'Working' }, { timeout: 3000 })).textContent).toMatch(
      /^Running a command · /,
    );

    // Another conversation resumes in place of this one; the plus starts a fresh one; a row can be renamed.
    fireEvent.click(within(group).getByRole('button', { name: 'Keychain recovery review' }));
    expect(window.api.homeChat.switch).toHaveBeenCalledWith('home-2');
    expect(useHomeChatStore.getState().currentId).toBe('home-2');
    fireEvent.click(within(group).getByRole('button', { name: 'Ship the settings page.' }));
    expect(useHomeChatStore.getState().currentId).toBe(CURRENT);
    fireEvent.click(within(group).getByRole('button', { name: 'New chat' }));
    expect(window.api.homeChat.create).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(within(group).getByRole('button', { name: 'Keychain recovery review' }));
    fireEvent.click(await screen.findByText('Rename'));
    const field = await within(group).findByLabelText('Name');
    fireEvent.change(field, { target: { value: 'Keychain' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(window.api.homeChat.rename).toHaveBeenCalledWith('home-2', 'Keychain');
    vi.mocked(window.api.homeChat.delete).mockResolvedValueOnce({
      currentId: CURRENT,
      chats: [{ id: CURRENT, title: 'Ship the settings page.', createdAt: '2026-11-10T00:00:00Z' }],
    });
    fireEvent.contextMenu(within(group).getByRole('button', { name: 'Keychain recovery review' }));
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(window.api.homeChat.delete).toHaveBeenCalledWith('home-2'));
    await act(async () => {});
    expect(within(group).queryByRole('button', { name: 'Keychain recovery review' })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Hide chats' }));
    expect(within(group).queryByRole('button', { name: 'Keychain recovery review' })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Show chats' }));

    // The gear opens Chat's settings, where a change of where it runs restarts the agent.
    expect(within(screen.getByRole('banner')).getByText('Ship the settings page.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chat settings' }));
    expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'settings' });
    expect(await screen.findByRole('heading', { name: 'Chat settings' })).toBeTruthy();
    // It runs on the host unless set otherwise, with no sandbox profile to show.
    expect(screen.getByRole('button', { name: 'Host', pressed: true })).toBeTruthy();
    expect(screen.queryByText('Sandbox profile')).toBeNull();
    // In the sandbox it has a profile of its own, and choosing another restarts it.
    fireEvent.click(screen.getByRole('button', { name: 'Sandbox' }));
    expect(window.api.globalSettings.set).toHaveBeenCalledWith(HOME_CHAT_SETTING_KEYS.sandbox, 'nono');
    await waitFor(() => expect(window.api.homeChat.restart).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Sandbox profile')).toBeTruthy();
    expect(window.api.sandbox.nonoProfile).toHaveBeenCalledWith(await window.api.homeChat.dir());
    vi.mocked(window.api.sandbox.chooseNonoProfile).mockResolvedValueOnce({
      path: '/Users/test/strict.json',
      own: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    await waitFor(() => expect(window.api.homeChat.restart).toHaveBeenCalledTimes(2));
    expect(screen.getByText('~/strict.json')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'A hook fails' }));
    expect(window.api.globalSettings.set).toHaveBeenCalledWith(
      HOME_CHAT_SETTING_KEYS.wake,
      JSON.stringify({ turnEnded: true, asked: true, taskMoved: true, hookFailed: false }),
    );
    expect(window.api.homeChat.restart).toHaveBeenCalledTimes(2);
    // In a custom sandbox it has a launcher of its own, and setting one restarts it.
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    await waitFor(() => expect(window.api.homeChat.restart).toHaveBeenCalledTimes(3));
    fireEvent.click(await screen.findByRole('button', { name: '+ Configure' }));
    fireEvent.change(screen.getByLabelText('Launcher command'), { target: { value: 'my-sandbox' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(window.api.homeChat.restart).toHaveBeenCalledTimes(4));
    expect(window.api.sandbox.setCustomConfig).toHaveBeenCalledWith(await window.api.homeChat.dir(), {
      command: 'my-sandbox',
    });

    // Escape leaves settings for the chat.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'chat' });
  });

  test('shows what it waits on you for as cards, with the same answers as the queue, and marks the row', async () => {
    adopt(transcript().map((n) => (n.id === 't4' ? { ...n, status: 'completed' } : n)) as ChatNode[], {
      status: 'idle',
    });
    // A worker Chat started, in a sandbox, with a request Chat left to the user.
    useHomeChatStore.setState({ owners: { [taskKey('/code/alpha', 12)]: CURRENT } });
    act(() =>
      useChatStore.getState().adopt({
        info: {
          ...INFO,
          id: 'pty-12',
          role: 'card',
          label: 'Settings storage',
          taskId: 12,
          projectPath: '/code/alpha',
          sandbox: 'nono',
        },
        nodes: [
          {
            kind: 'request',
            id: 'req-1',
            parentId: null,
            createdAt: 1,
            request: 'approval',
            title: 'Delete old.test.tsx',
            detail: 'rm src/old.test.tsx',
            options: [
              { id: 'allow', label: 'Allow', kind: 'allow_once' },
              { id: 'deny', label: 'Deny', kind: 'reject_once' },
            ],
            questions: [],
            status: 'pending',
          } as ChatNode,
        ],
        seq: 1,
      }),
    );
    // What Chat set off, as the main process holds it.
    let pushDecisions: (decisions: ChatDecision[]) => void = () => {};
    vi.mocked(window.api.homeChat.onDecisions).mockImplementation((listener) => {
      pushDecisions = listener;
      return () => {};
    });
    listenForChatDecisions();
    const held: ChatDecision[] = [
      {
        id: 'd-ask',
        from: CURRENT,
        at: 1,
        kind: 'ask',
        ask: { command: 'gh pr list', cwd: '/chat' },
        message: 'needs your GitHub sign-in',
      },
      {
        id: 'd-push',
        from: CURRENT,
        at: 2,
        kind: 'ask',
        ask: { command: 'git push', cwd: '/code/alpha' },
      },
    ];
    act(() => pushDecisions(held));
    render(<App />);
    act(() => useAppStore.getState().select({ kind: 'chat', page: 'chat' }));

    const cards = () => [...document.querySelectorAll<HTMLElement>('[data-chat-decision]')];
    expect(cards()).toHaveLength(3);
    const [ask, push, worker] = cards();
    expect(ask.textContent).toContain('gh pr list');
    expect(ask.textContent).toContain('needs your GitHub sign-in');
    expect(push.textContent).toContain('git push');
    expect(worker.textContent).toContain('Delete old.test.tsx');

    // The row of the conversation carries a dot while anything waits.
    const group = screen
      .getByRole('complementary', { name: 'Sidebar' })
      .querySelector<HTMLElement>('[data-group="home-chat"]')!;
    expect(within(group).getByLabelText('3 waiting on you')).toBeTruthy();

    // Answering a card answers the main process, and the queue follows what it holds.
    fireEvent.click(within(ask).getByRole('button', { name: 'Run' }));
    expect(window.api.homeChat.decide).toHaveBeenCalledWith('d-ask', { kind: 'run', privately: false });
    fireEvent.click(within(push).getByRole('button', { name: 'Decline' }));
    expect(window.api.homeChat.decide).toHaveBeenCalledWith('d-push', { kind: 'decline' });
    act(() => pushDecisions([]));
    expect(useWaitingStore.getState().items).toEqual([]);
    fireEvent.click(within(worker).getByRole('button', { name: 'Deny' }));
    expect(window.api.chat.answer).toHaveBeenCalledWith('pty-12', 'req-1', { kind: 'option', optionId: 'deny' });

    // Nothing waits while Chat is still working out what to do with a request.
    adopt(transcript(), { status: 'running' });
    expect(cards().some((card) => card.textContent?.includes('Delete old.test.tsx'))).toBe(false);
  });
});
