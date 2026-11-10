import { BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import { chatHost } from '../../chat/host';
import { getDriver } from '../../chat/drivers';
import type { ChatAnswer } from '../../chat/model';
import { restartHomeChat, startHomeChat } from '../../chat/homeChat';
import { describeSession, installHomeChatWakes, wakeHomeChat } from '../../chat/wake';
import { HOME_CHAT_ID } from '../../chat/preferences';

export function registerChatHandlers(mainWindow: BrowserWindow): void {
  chatHost.subscribe((sessionId, event) => typedPush(mainWindow, 'chat:event', sessionId, event));

  typedHandle('chat:probe', (agent) => getDriver(agent).probe());
  typedHandle('chat:start', (options) => chatHost.start(options));
  typedHandle('chat:snapshot', (id) => chatHost.snapshot(id));
  typedHandle('chat:list-live', () => chatHost.list());
  typedHandle('chat:since', (id, seq) => chatHost.since(id, seq));
  typedHandle('chat:latest-for-task', (projectPath, taskId) => chatHost.latestForTask(projectPath, taskId));
  typedHandle('chat:prompt', async (id, input, delivery) => {
    const messageId = await chatHost.prompt(id, input, delivery);
    if (input.typed && id !== HOME_CHAT_ID) void tellHomeChat(id, (who) => `you told ${who} "${input.text}"`);
    return messageId;
  });
  typedHandle('chat:answer', (id, requestId, answer) => {
    const answered = chatHost.answer(id, requestId, answer);
    if (answered && id !== HOME_CHAT_ID) {
      void tellHomeChat(id, (who) => `you answered ${who} request ${requestId} yourself: ${describeAnswer(answer)}.`);
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
  typedHandle('homeChat:start', () => startHomeChat({ eager: true }));
  typedHandle('homeChat:wake', (event, text) => wakeHomeChat(event, text));
  typedHandle('homeChat:restart', () => restartHomeChat());
  typedHandle('chat:terminal-resume', (id) => {
    const snapshot = chatHost.snapshot(id);
    return snapshot ? getDriver(snapshot.info.agent).terminalResume(snapshot.info.agentSessionId) : null;
  });
}

/** The user acted on a worker from its own card, which Chat may be steering. */
async function tellHomeChat(id: string, text: (who: string) => string): Promise<void> {
  const info = chatHost.snapshot(id)?.info;
  if (!info) return;
  await wakeHomeChat(null, text(await describeSession(info)));
}

function describeAnswer(answer: ChatAnswer): string {
  switch (answer.kind) {
    case 'option':
      return answer.optionId;
    case 'answers':
      return Object.entries(answer.answers)
        .map(([question, reply]) => `${question}=${reply.join('/')}`)
        .join(', ');
    default:
      return answer.kind;
  }
}
