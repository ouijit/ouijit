import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { ChatView } from '../../components/chat/ChatView';
import { useChatStore, listenForChatEvents } from '../../stores/chatStore';
import {
  NO_CAPABILITIES,
  applyChatEvent,
  type ChatEvent,
  type ChatNode,
  type ChatSessionInfo,
  type SequencedChatEvent,
} from '../../chat/model';

// xterm cannot construct under jsdom; the chat view never touches a terminal.
vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  resolveTerminalLabel: () => '',
}));

const ID = 'pty-chat';

/**
 * The host's side of the IPC contract, kept honest: every change is an event
 * with the next sequence number, pushed to whoever listens, and a snapshot is
 * the state those events produce.
 */
function fakeHost(info: ChatSessionInfo, nodes: ChatNode[]) {
  const state = { info, nodes: [...nodes] };
  let seq = 0;
  let listener: ((id: string, event: SequencedChatEvent) => void) | null = null;
  const emit = (event: ChatEvent) => {
    applyChatEvent(state, event);
    listener?.(ID, { seq: ++seq, event });
  };
  window.api.chat.onEvent = vi.fn((callback) => {
    listener = callback;
    return () => (listener = null);
  });
  window.api.chat.snapshot = vi.fn(async () => ({ info: state.info, nodes: state.nodes, seq }));
  window.api.chat.prompt = vi.fn(async (_id, input) => {
    emit({
      type: 'node',
      node: {
        id: `user-${seq}`,
        kind: 'user_message',
        parentId: null,
        createdAt: 0,
        text: input.text,
        attachments: [],
        delivery: 'prompt',
      },
    });
    emit({ type: 'session', patch: { status: 'running' } });
    return `user-${seq}`;
  });
  window.api.chat.answer = vi.fn(async (_id, requestId, answer) => {
    const node = state.nodes.find((n) => n.id === requestId);
    if (!node || node.kind !== 'request') return false;
    emit({ type: 'node', node: { ...node, status: 'answered', answer } });
    return true;
  });
  return { emit };
}

const INFO: ChatSessionInfo = {
  id: ID,
  agent: 'claude',
  agentSessionId: 'abc',
  projectPath: '/p',
  cwd: '/p',
  worktreePath: null,
  sandbox: null,
  taskId: 1,
  status: 'idle',
  capabilities: { ...NO_CAPABILITIES, interrupt: true, commands: true, models: true, modes: true },
  models: [
    { id: 'default', label: 'Default (recommended)', standsFor: 'Sonnet' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus', label: 'Opus' },
  ],
  model: 'default',
  efforts: [],
  modes: [
    { id: 'default', label: 'Ask' },
    { id: 'acceptEdits', label: 'Accept edits' },
  ],
  mode: 'default',
  commands: [
    { name: 'review', description: 'Review the diff' },
    { name: 'compact', description: 'Compact the conversation' },
  ],
};

const NODES: ChatNode[] = [
  {
    id: 'u1',
    kind: 'user_message',
    parentId: null,
    createdAt: 0,
    text: 'Fix the login bug',
    attachments: [],
    delivery: 'prompt',
  },
  {
    id: 'a1',
    kind: 'assistant_message',
    parentId: null,
    createdAt: 0,
    text: 'Looking at **auth.ts** now.',
    status: 'completed',
  },
  {
    id: 't1',
    kind: 'tool_call',
    parentId: null,
    createdAt: 0,
    tool: 'command',
    name: 'Bash',
    title: 'Run the tests',
    input: {},
    command: 'npm test',
    output: '3 passing',
    files: [],
    status: 'completed',
  },
  // A turn that fans out: four subagents at once, each a few steps in. Agent 1
  // has finished; agent 2 runs in the background, so its launch call is done
  // while it is not.
  ...[1, 2, 3, 4].flatMap((n): ChatNode[] => [
    {
      id: `agent${n}`,
      kind: 'tool_call',
      parentId: null,
      createdAt: 0,
      tool: 'subagent',
      name: 'Agent',
      title: `Agent ${n}`,
      input: {},
      files: [],
      status: n <= 2 ? 'completed' : 'running',
    },
    {
      id: `task${n}`,
      kind: 'subagent',
      parentId: `agent${n}`,
      createdAt: 0,
      title: `Survey module ${n}`,
      status: n === 1 ? 'completed' : 'running',
    },
    ...[1, 2, 3].map((step): ChatNode => ({
      id: `agent${n}-step${step}`,
      kind: 'tool_call',
      parentId: `agent${n}`,
      createdAt: 0,
      tool: 'read',
      name: 'Read',
      title: `Read module${n}/file${step}.ts`,
      input: {},
      files: [],
      status: 'completed',
    })),
  ]),
];

beforeEach(async () => {
  useChatStore.setState({ sessions: {}, setup: {}, drafts: {} });
});

describe('chat view', () => {
  test('renders the transcript, answers an approval, and sends what is typed — commands included', async () => {
    const host = fakeHost(INFO, NODES);
    listenForChatEvents();
    useChatStore.getState().adopt(await window.api.chat.snapshot(ID)!);
    render(<ChatView cardId={ID} />);

    expect(screen.getByText('Fix the login bug')).toBeTruthy();
    expect(screen.getByText('auth.ts').tagName).toBe('STRONG');

    // A finished turn's work is one closed line above its reply; opened, each tool call is a line of its own.
    expect(screen.queryByRole('button', { name: /Run the tests/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Ran 1 command/ }));
    expect(screen.queryByText('3 passing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Run the tests/ }));
    expect(screen.getByText('3 passing')).toBeTruthy();
    expect(screen.getByText('$ npm test')).toBeTruthy();

    // The agent blocks on a person; answering it resolves the request on the host.
    act(() =>
      host.emit({
        type: 'node',
        node: {
          id: 'r1',
          kind: 'request',
          parentId: null,
          createdAt: 0,
          request: 'approval',
          title: "python3 - <<'EOF'\nimport shutil; shutil.rmtree('build')\nEOF",
          options: [
            { id: 'allow', label: 'Allow', kind: 'allow_once' },
            { id: 'deny', label: 'Deny', kind: 'reject_once' },
          ],
          questions: [],
          status: 'pending',
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(window.api.chat.answer).toHaveBeenCalledWith(ID, 'r1', { kind: 'option', optionId: 'allow' });
    // Allowed, it leaves the transcript at once: the step it gated is the record.
    await waitFor(() => expect(screen.queryByText(/shutil/)).toBeNull());
    expect(screen.queryByRole('button', { name: /Allowed$/ })).toBeNull();

    // A refusal stays as one line, naming the command by what the agent said it does.
    act(() => {
      host.emit({
        type: 'node',
        node: {
          id: 'c2',
          kind: 'tool_call',
          parentId: null,
          createdAt: 0,
          tool: 'command',
          name: 'Bash',
          title: 'List the open tasks',
          command: 'ouijit task list | jq \'[.[] | select(.status != "done")]\'',
          input: {},
          files: [],
          status: 'completed',
        },
      });
      host.emit({
        type: 'node',
        node: {
          id: 'r2',
          kind: 'request',
          parentId: null,
          createdAt: 0,
          request: 'approval',
          title: 'ouijit task list | jq \'[.[] | select(.status != "done")]\'',
          toolCallId: 'c2',
          options: [{ id: 'deny', label: 'Deny', kind: 'reject_once' }],
          questions: [],
          status: 'answered',
          answer: { kind: 'option', optionId: 'deny' },
        },
      });
    });
    const declined = await screen.findByRole('button', { name: /^List the open tasksDeclined$/ });
    fireEvent.click(declined);
    expect(screen.getByText(/select\(\.status != "done"\)/)).toBeTruthy();

    // A slash opens the agent's commands; Tab takes the highlighted one.
    const composer = screen.getByLabelText('Message');
    fireEvent.change(composer, { target: { value: '/re' } });
    expect(screen.getByRole('option', { name: /\/review/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /\/compact/ })).toBeNull();
    fireEvent.keyDown(composer, { key: 'Tab' });
    expect((composer as HTMLTextAreaElement).value).toBe('/review ');

    fireEvent.change(composer, { target: { value: 'and add a test' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() =>
      expect(window.api.chat.prompt).toHaveBeenCalledWith(
        ID,
        { text: 'and add a test', attachments: [], typed: true },
        'auto',
      ),
    );
    expect(await screen.findByText('and add a test')).toBeTruthy();
    expect((composer as HTMLTextAreaElement).value).toBe('');

    // A command the chat does not list belongs to the agent's terminal: it is
    // not sent, and the composer offers the terminal instead.
    vi.mocked(window.api.chat.prompt).mockClear();
    fireEvent.change(composer, { target: { value: '/login' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'Open in terminal' })).toBeTruthy();
    expect(screen.getByText(/runs in Claude Code/)).toBeTruthy();
    expect(window.api.chat.prompt).not.toHaveBeenCalled();
    // A path is text, not a command.
    fireEvent.change(composer, { target: { value: '/Users/me/notes.md looks wrong' } });
    expect(screen.queryByRole('button', { name: 'Open in terminal' })).toBeNull();

    // A command that needs nothing more runs on Enter, without being filled in first.
    vi.mocked(window.api.chat.prompt).mockClear();
    fireEvent.change(composer, { target: { value: '/comp' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() =>
      expect(window.api.chat.prompt).toHaveBeenCalledWith(
        ID,
        { text: '/compact', attachments: [], typed: true },
        'auto',
      ),
    );
    // After /model, the menu offers the models; the pointer moves the highlight, and Enter runs the one picked.
    fireEvent.change(composer, { target: { value: '/model ' } });
    expect(screen.getByRole('listbox', { name: 'Choose a model' })).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Opus' }));
    expect(screen.getByRole('option', { name: 'Opus' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() =>
      expect(window.api.chat.prompt).toHaveBeenCalledWith(
        ID,
        { text: '/model opus', attachments: [], typed: true },
        'auto',
      ),
    );

    // While the agent works, the composer offers Stop.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy());
    // Escape with the menu open closes the menu; it does not stop the agent.
    const interrupts = vi.mocked(window.api.chat.interrupt).mock.calls.length;
    fireEvent.change(composer, { target: { value: '/' } });
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy();
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(window.api.chat.interrupt).toHaveBeenCalledTimes(interrupts);
    fireEvent.change(composer, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(window.api.chat.interrupt).toHaveBeenCalledWith(ID);

    // An attached image shows itself on hover or focus; another file is just its name.
    vi.mocked(window.api.getPathForFile).mockImplementation((file) => `/tmp/${file.name}`);
    vi.mocked(window.api.chat.attachmentPreview).mockResolvedValue('data:image/png;base64,AAAA');
    fireEvent.drop(composer, {
      dataTransfer: { files: [new File([''], 'shot.png'), new File([''], 'notes.txt')] },
    });
    const shot = screen.getByText('shot.png');
    fireEvent.mouseEnter(shot);
    expect((await screen.findByRole('img', { name: 'shot.png' })).getAttribute('src')).toBe(
      'data:image/png;base64,AAAA',
    );
    fireEvent.mouseLeave(shot);
    expect(screen.queryByRole('img', { name: 'shot.png' })).toBeNull();
    fireEvent.focus(shot);
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeTruthy();
    fireEvent.blur(shot);
    fireEvent.mouseEnter(screen.getByText('notes.txt'));
    expect(window.api.chat.attachmentPreview).toHaveBeenCalledTimes(1);
    for (const name of ['shot.png', 'notes.txt'])
      fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));

    // Subagents launched together are one line of counts, each one a line of
    // its own inside: its task, its latest step while it runs, and a count.
    expect(screen.getByText('4 subagents')).toBeTruthy();
    expect(screen.getByText('3 running · 1 done')).toBeTruthy();
    expect(screen.queryByText('Survey module 4')).toBeNull();
    fireEvent.click(screen.getByText('4 subagents'));
    expect(screen.getByText('Survey module 4')).toBeTruthy();
    expect(screen.getByText('Read module4/file3.ts')).toBeTruthy();
    expect(screen.queryByText('Read module4/file1.ts')).toBeNull();
    expect(screen.queryByText('Read module1/file3.ts')).toBeNull();
    expect(screen.getAllByText('3 steps')).toHaveLength(4);
    fireEvent.click(screen.getByText('Survey module 4'));
    expect(screen.getByText('Read module4/file1.ts')).toBeTruthy();

    // Work the agent leaves running is listed above the composer: how long it has run,
    // its latest output a click away, a stop, and a tag on the call that started it.
    const started = Date.now() - 125_000;
    vi.mocked(window.api.chat.backgroundOutput).mockResolvedValue('compiling\nready on :5173\n');
    act(() =>
      host.emit({
        type: 'session',
        patch: {
          status: 'idle',
          background: [
            { id: 'bash-1', kind: 'shell', description: 'npm run dev', startedAt: started, toolCallId: 't1' },
          ],
        },
      }),
    );
    const dev = await screen.findByRole('button', { name: /^npm run dev\s?· 2m$/ });
    fireEvent.click(dev);
    expect(await screen.findByText(/ready on :5173/)).toBeTruthy();
    expect(window.api.chat.backgroundOutput).toHaveBeenCalledWith(ID, 'bash-1');
    fireEvent.click(screen.getByRole('button', { name: 'Stop npm run dev' }));
    expect(window.api.chat.stopBackground).toHaveBeenCalledWith(ID, 'bash-1');
    // Taken at once: the row says so, with no second stop to press.
    expect(screen.getByText('Stopping')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop npm run dev' })).toBeNull();
    // Several fold behind a count, naming the newest, until opened.
    act(() =>
      host.emit({
        type: 'session',
        patch: {
          background: [1, 2, 3, 4, 5].map((n) => ({
            id: `agent-${n}`,
            kind: 'agent' as const,
            description: `Survey ${n}`,
            startedAt: started + n * 1000,
          })),
        },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Stop Survey 5' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^5 running · Survey 5/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop Survey 5' }));
    expect(window.api.chat.stopBackground).toHaveBeenCalledWith(ID, 'agent-5');
    act(() => host.emit({ type: 'session', patch: { background: [] } }));
    expect(screen.queryByRole('list', { name: 'Running in the background' })).toBeNull();

    // What the agent thought folds to a line with the rest of its work, opened as plain text.
    act(() => {
      host.emit({ type: 'session', patch: { status: 'idle' } });
      host.emit({
        type: 'node',
        node: {
          kind: 'reasoning',
          id: 'think-1',
          parentId: null,
          createdAt: Date.now() - 12_000,
          endedAt: Date.now(),
          text: 'Keeping the reply short, since they only said hi.',
          status: 'completed',
        },
      });
      host.emit({
        type: 'node',
        node: {
          kind: 'assistant_message',
          id: 'hi-1',
          parentId: null,
          createdAt: Date.now(),
          text: 'Hi.',
          status: 'completed',
        },
      });
    });
    expect(screen.queryByText('Keeping the reply short, since they only said hi.')).toBeNull();
    const thought = screen.getAllByRole('button', { name: /^Thought/ }).at(-1)!;
    // How long it thought follows the line, as every duration does.
    expect(thought.textContent).toBe('Thought · 12s');
    expect(thought.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(thought);
    expect(screen.getByText('Keeping the reply short, since they only said hi.')).toBeTruthy();

    // Model and mode share one button that names the model, the real one
    // behind an alias; the menu lists the settings, and each opens to its options.
    const settings = screen.getByRole('button', { name: 'Agent settings' });
    expect(settings.textContent).toBe('Sonnet');
    fireEvent.click(settings);
    expect(screen.queryByRole('menuitemradio', { name: 'Opus' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Model/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Opus' }));
    expect(window.api.chat.setModel).toHaveBeenCalledWith(ID, 'opus');
    fireEvent.click(settings);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Mode(?!l)/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Accept edits' }));
    expect(window.api.chat.setMode).toHaveBeenCalledWith(ID, 'acceptEdits');
  });
});

describe('a long fold', () => {
  test('an opened fold too tall for the screen fades out, and Show more lets it down a step at a time', async () => {
    fakeHost(INFO, NODES);
    listenForChatEvents();
    useChatStore.getState().adopt(await window.api.chat.snapshot(ID)!);
    const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    try {
      render(<ChatView cardId={ID} />);
      fireEvent.click(screen.getByRole('button', { name: /^Ran 1 command/ }));
      const shown = () => screen.getByRole('button', { name: /Run the tests/ }).closest('[style]') as HTMLElement;
      expect(shown().style.maxHeight).toBe('480px');
      expect(shown().style.maskImage).toContain('linear-gradient');
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(shown().style.maxHeight).toBe('960px');
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
      expect(shown().style.maskImage).toBe('');
    } finally {
      tall.mockRestore();
    }
  });
});

describe('stopping a turn', () => {
  test('shows at once: what was streaming lands whole, the working line says Stopping, and the stop button goes', async () => {
    const reply = 'Here is the plan, still arriving a few characters at a time when the user pressed stop.';
    const text = `${reply}\n\nFirst the query, then the component.`;
    const live = (patch: Partial<ChatSessionInfo>, extra: ChatNode[] = []) =>
      act(() =>
        useChatStore
          .getState()
          .adopt({ info: { ...INFO, status: 'running', ...patch }, nodes: [...NODES, ...extra], seq: 0 }),
      );
    live({});
    render(<ChatView cardId={ID} />);
    live({}, [
      {
        id: 'u9',
        kind: 'user_message',
        parentId: null,
        createdAt: 0,
        text: 'Keep going',
        attachments: [],
        delivery: 'prompt',
      },
      { id: 'a9', kind: 'assistant_message', parentId: null, createdAt: 0, text, status: 'running' },
    ]);
    expect(screen.queryByText(reply)).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();

    live({ stopping: true }, [
      {
        id: 'u9',
        kind: 'user_message',
        parentId: null,
        createdAt: 0,
        text: 'Keep going',
        attachments: [],
        delivery: 'prompt',
      },
      { id: 'a9', kind: 'assistant_message', parentId: null, createdAt: 0, text, status: 'running' },
    ]);
    expect(screen.getByText(reply)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('compacting from chat', () => {
  test('says so below the last turn until the compaction lands', () => {
    const live = (patch: Partial<ChatSessionInfo>, extra: ChatNode[] = []) =>
      act(() => useChatStore.getState().adopt({ info: { ...INFO, ...patch }, nodes: [...NODES, ...extra], seq: 0 }));
    live({ status: 'idle' });
    render(<ChatView cardId={ID} />);
    live({ status: 'running', compacting: Date.now() });
    expect(screen.getByRole('status', { name: 'Working' }).textContent).toContain('Compacting');
    expect(screen.queryByText('Thinking')).toBeNull();

    live({ status: 'idle', compacting: null }, [
      { id: 'c1', kind: 'compaction', parentId: null, createdAt: 0, trigger: 'manual' },
    ]);
    expect(screen.queryByText('Compacting')).toBeNull();
    expect(screen.getByText('Context compacted')).toBeTruthy();
  });
});

describe('a background shell', () => {
  test('tags the call that started it, and on ending says how in the bar a moment, or not at all when stopped, and in the transcript for good', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    const at = Date.now();
    const call: ChatNode = {
      id: 'tool-build',
      kind: 'tool_call',
      parentId: null,
      createdAt: at,
      tool: 'command',
      title: 'Build the app',
      command: 'npm run make',
      status: 'completed',
      files: [],
      output: '',
    };
    const task = { id: 'b1', kind: 'shell' as const, description: 'Build the app', startedAt: at, toolCallId: call.id };
    const live = (patch: Partial<ChatSessionInfo>, extra: ChatNode[] = []) =>
      act(() =>
        useChatStore
          .getState()
          .adopt({ info: { ...INFO, status: 'idle', ...patch }, nodes: [...NODES, call, ...extra], seq: 0 }),
      );
    live({ background: [task] });
    render(<ChatView cardId={ID} />);
    // It sits in the turn's folded work, with the rest of what the agent did.
    fireEvent.click(screen.getAllByRole('button', { name: /^Ran / }).at(-1)!);
    expect(screen.getByRole('button', { name: /^Build the app\s?In background$/ })).toBeTruthy();

    const ended: ChatNode = {
      id: 'ended-b1',
      kind: 'notice',
      parentId: null,
      createdAt: at + 180_000,
      level: 'error',
      text: 'Build the app',
      ended: { taskId: 'b1', status: 'failed', ms: 180_000 },
    };
    live({ background: [] }, [ended]);
    const bar = screen.getByRole('list', { name: 'Running in the background' });
    expect(bar.textContent).toMatch(/^Build the app\s?· 3m$/);
    expect(screen.queryByRole('button', { name: 'Stop Build the app' })).toBeNull();
    expect(screen.getAllByText('Build the app')).toHaveLength(3);

    // A moment later it folds away, leaving the transcript's row: the mark, the name, the time.
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('list', { name: 'Running in the background' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByRole('list', { name: 'Running in the background' })).toBeNull();
    const kept = [...document.querySelectorAll('.chat-turns div')].filter((el) =>
      /^Build the app\s?· 3m$/.test(el.textContent ?? ''),
    );
    expect(kept.length).toBeGreaterThan(0);

    // One the user stopped goes as soon as it ends: they already know how.
    const server = { id: 's1', kind: 'shell' as const, description: 'Dev server', startedAt: at };
    live({ background: [server] }, [ended]);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Dev server' }));
    const stopped: ChatNode = {
      id: 'ended-s1',
      kind: 'notice',
      parentId: null,
      createdAt: at + 60_000,
      level: 'info',
      text: 'Dev server',
      ended: { taskId: 's1', status: 'stopped', ms: 60_000 },
    };
    live({ background: [] }, [ended, stopped]);
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByRole('list', { name: 'Running in the background' })).toBeNull();
    vi.useRealTimers();
  });
});
