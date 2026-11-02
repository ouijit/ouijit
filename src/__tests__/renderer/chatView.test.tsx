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
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus', label: 'Opus' },
  ],
  model: 'sonnet',
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
    ...[1, 2, 3].map(
      (step): ChatNode => ({
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
      }),
    ),
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

    // A tool call is one line until opened.
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
          title: 'Run rm -rf build',
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
    await waitFor(() => expect(screen.getByText(/Run rm -rf build · Allow/)).toBeTruthy());

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
      expect(window.api.chat.prompt).toHaveBeenCalledWith(ID, { text: 'and add a test', attachments: [] }, 'auto'),
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

    // While the agent works, the composer offers Stop.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(window.api.chat.interrupt).toHaveBeenCalledWith(ID);

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

    // Work the agent leaves running is listed above the composer, each with a stop.
    act(() =>
      host.emit({
        type: 'session',
        patch: { status: 'idle', background: [{ id: 'bash-1', kind: 'shell', description: 'npm run dev' }] },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Stop npm run dev' }));
    expect(window.api.chat.stopBackground).toHaveBeenCalledWith(ID, 'bash-1');
    // Several fold behind a count until opened.
    act(() =>
      host.emit({
        type: 'session',
        patch: {
          background: [1, 2, 3, 4, 5].map((n) => ({
            id: `agent-${n}`,
            kind: 'agent' as const,
            description: `Survey ${n}`,
          })),
        },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Stop Survey 5' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '5 running in the background' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop Survey 5' }));
    expect(window.api.chat.stopBackground).toHaveBeenCalledWith(ID, 'agent-5');
    act(() => host.emit({ type: 'session', patch: { background: [] } }));
    expect(screen.queryByRole('list', { name: 'Running in the background' })).toBeNull();

    // Model and mode share one button that names both; the menu lists the
    // settings, and each opens to its options.
    const settings = screen.getByRole('button', { name: 'Agent settings' });
    expect(settings.textContent).toBe('Sonnet · Ask');
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
