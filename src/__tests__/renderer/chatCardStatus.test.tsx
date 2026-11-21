import { expect, test, vi } from 'vitest';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import { initChat } from '../../components/chat/chatActions';
import { useChatStore } from '../../stores/chatStore';
import { NO_CAPABILITIES, type ChatSessionInfo, type SequencedChatEvent } from '../../chat/model';

vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  resolveTerminalLabel: () => '',
}));
vi.mock('../../components/terminal/terminalActions', () => ({}));

const ID = 'pty-chat';
const INFO = {
  id: ID,
  agent: 'claude',
  agentSessionId: 'abc',
  projectPath: '/p',
  cwd: '/p',
  worktreePath: null,
  sandbox: null,
  taskId: 4,
  status: 'running',
  capabilities: NO_CAPABILITIES,
  models: [],
  efforts: [],
  modes: [],
  commands: [],
} as ChatSessionInfo;

test('a chat card stays working until its turn and its background work have both ended', () => {
  let deliver: (id: string, event: SequencedChatEvent) => void = () => {};
  vi.mocked(window.api.chat.onEvent).mockImplementation((listener) => {
    deliver = listener;
    return () => {};
  });
  const setAgentStatus = vi.fn();
  terminalInstances.set(ID, { surface: 'chat', setAgentStatus } as unknown as OuijitTerminal);
  useChatStore.getState().adopt({ info: INFO, nodes: [], seq: 0 });
  initChat();
  let seq = 0;
  const patch = (patch: Partial<ChatSessionInfo>) => deliver(ID, { seq: ++seq, event: { type: 'session', patch } });
  const shell = { id: 'b1', kind: 'shell' as const, description: 'npm run dev', startedAt: 1 };

  patch({ background: [shell] });
  patch({ status: 'idle' });
  expect(setAgentStatus).toHaveBeenLastCalledWith('thinking');
  patch({ background: [] });
  expect(setAgentStatus).toHaveBeenLastCalledWith('ready');
});
