import { BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import { chatHost } from '../../chat/host';
import { getDriver } from '../../chat/drivers';

export function registerChatHandlers(mainWindow: BrowserWindow): void {
  chatHost.subscribe((sessionId, event) => typedPush(mainWindow, 'chat:event', sessionId, event));

  typedHandle('chat:probe', (agent) => getDriver(agent).probe());
  typedHandle('chat:start', (options) => chatHost.start(options));
  typedHandle('chat:snapshot', (id) => chatHost.snapshot(id));
  typedHandle('chat:list-live', () => chatHost.list());
  typedHandle('chat:since', (id, seq) => chatHost.since(id, seq));
  typedHandle('chat:latest-for-task', (projectPath, taskId) => chatHost.latestForTask(projectPath, taskId));
  typedHandle('chat:prompt', (id, input, delivery) => chatHost.prompt(id, input, delivery));
  typedHandle('chat:answer', (id, requestId, answer) => chatHost.answer(id, requestId, answer));
  typedHandle('chat:interrupt', (id) => chatHost.interrupt(id));
  typedHandle('chat:set-model', (id, model) => chatHost.setModel(id, model));
  typedHandle('chat:set-effort', (id, effort) => chatHost.setEffort(id, effort));
  typedHandle('chat:set-mode', (id, mode) => chatHost.setMode(id, mode));
  typedHandle('chat:rewind', (id, userMessageId) => chatHost.rewind(id, userMessageId));
  typedHandle('chat:compact', (id) => chatHost.compact(id));
  typedHandle('chat:fork', (id) => chatHost.fork(id));
  typedHandle('chat:stop', (id) => chatHost.stop(id));
  typedHandle('chat:discard', (id) => chatHost.discard(id));
  typedHandle('chat:terminal-resume', (id) => {
    const snapshot = chatHost.snapshot(id);
    return snapshot ? getDriver(snapshot.info.agent).terminalResume(snapshot.info.agentSessionId) : null;
  });
}
