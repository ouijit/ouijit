import { BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import { chatHost } from '../../chat/host';
import { getDriver } from '../../chat/drivers';
import type { ChatAnswer } from '../../chat/model';
import {
  deleteHomeChat,
  homeChatState,
  installHomeChat,
  newHomeChat,
  onHomeChatChange,
  renameHomeChat,
  restartHomeChat,
  isHomeChat,
  startHomeChat,
  switchHomeChat,
} from '../../chat/homeChat';
import { describeSession, installHomeChatWakes, sessionName, sessionTask, wakeHomeChat } from '../../chat/wake';
import { chatDecisions, decide, dropDecisionsFrom, onChatDecisionsChange } from '../../chat/decisions';

export function registerChatHandlers(mainWindow: BrowserWindow): void {
  chatHost.subscribe((sessionId, event) => typedPush(mainWindow, 'chat:event', sessionId, event));

  typedHandle('chat:probe', (agent) => getDriver(agent).probe());
  // Only Chat's own module makes one of its conversations: the role is what grants its reach.
  typedHandle('chat:start', ({ role: _role, ...options }) => chatHost.start(options));
  typedHandle('chat:snapshot', (id) => chatHost.snapshot(id));
  typedHandle('chat:list-live', () => chatHost.list());
  typedHandle('chat:since', (id, seq) => chatHost.since(id, seq));
  typedHandle('chat:latest-for-task', (projectPath, taskId) => chatHost.latestForTask(projectPath, taskId));
  typedHandle('chat:prompt', async (id, input, delivery) => {
    const messageId = await chatHost.prompt(id, input, delivery);
    if (input.typed && !isHomeChat(id)) {
      void tellHomeChat(
        id,
        (who) => `the user told ${who} "${input.text}"`,
        (name) => `You told ${name}: ${clip(input.text)}`,
      );
    }
    return messageId;
  });
  typedHandle('chat:answer', (id, requestId, answer) => {
    const answered = chatHost.answer(id, requestId, answer);
    if (answered && !isHomeChat(id)) {
      const said = describeAnswer(id, requestId, answer);
      void tellHomeChat(
        id,
        (who) => `the user answered ${who} request ${requestId} themselves: ${said}.`,
        (name) => `You answered ${name}: ${said}`,
      );
    }
    return answered;
  });
  typedHandle('chat:interrupt', (id) => chatHost.interrupt(id));
  typedHandle('chat:set-model', (id, model) => chatHost.setModel(id, model));
  typedHandle('chat:set-effort', (id, effort) => chatHost.setEffort(id, effort));
  typedHandle('chat:set-mode', (id, mode) => chatHost.setMode(id, mode));
  typedHandle('chat:rewind', (id, userMessageId) => chatHost.rewind(id, userMessageId));
  typedHandle('chat:compact', (id) => chatHost.compact(id));
  typedHandle('chat:stopBackground', (id, taskId) => chatHost.stopBackground(id, taskId));
  typedHandle('chat:fork', (id) => chatHost.fork(id));
  typedHandle('chat:stop', (id) => chatHost.stop(id));
  typedHandle('chat:discard', (id) => chatHost.discard(id));
  installHomeChatWakes();
  installHomeChat();
  onHomeChatChange((state) => typedPush(mainWindow, 'homeChat:changed', state));
  typedHandle('homeChat:start', () => startHomeChat({ eager: true }));
  typedHandle('homeChat:new', (id) => newHomeChat(id));
  typedHandle('homeChat:switch', (id) => switchHomeChat(id));
  typedHandle('homeChat:list', () => homeChatState());
  typedHandle('homeChat:rename', (id, title) => renameHomeChat(id, title));
  typedHandle('homeChat:delete', async (id) => {
    await dropDecisionsFrom(id);
    return deleteHomeChat(id);
  });
  onChatDecisionsChange((decisions) => typedPush(mainWindow, 'homeChat:decisions-changed', decisions));
  typedHandle('homeChat:decisions', () => chatDecisions());
  typedHandle('homeChat:decide', (id, choice) => decide(id, choice));
  typedHandle('homeChat:wake', (event, text, note, about) =>
    wakeHomeChat(event, text, { kind: 'event', text: note }, about),
  );
  typedHandle('homeChat:restart', () => restartHomeChat());
  typedHandle('chat:terminal-resume', (id) => {
    const snapshot = chatHost.snapshot(id);
    return snapshot ? getDriver(snapshot.info.agent).terminalResume(snapshot.info.agentSessionId) : null;
  });
}

/** The user acted on a worker from its own card, which Chat may be steering. */
async function tellHomeChat(id: string, text: (who: string) => string, note: (name: string) => string): Promise<void> {
  const info = chatHost.snapshot(id)?.info;
  if (!info) return;
  const [who, name] = await Promise.all([describeSession(info), sessionName(info)]);
  await wakeHomeChat(null, text(who), { kind: 'decision', text: note(name) }, sessionTask(id));
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** An answer in the words its options were shown in. */
function describeAnswer(id: string, requestId: string, answer: ChatAnswer): string {
  switch (answer.kind) {
    case 'option': {
      const request = chatHost.snapshot(id)?.nodes.find((n) => n.id === requestId);
      const option = request?.kind === 'request' ? request.options.find((o) => o.id === answer.optionId) : undefined;
      return option?.label ?? answer.optionId;
    }
    case 'answers':
      return Object.entries(answer.answers)
        .map(([question, reply]) => `${question}=${reply.join('/')}`)
        .join(', ');
    default:
      return answer.kind;
  }
}
