import log from 'electron-log/renderer';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAppStore } from '../../stores/appStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { generateId } from '../../utils/ids';
import { HOME_CHAT_ID_PREFIX } from '../../chat/preferences';
import { NO_CAPABILITIES } from '../../chat/model';

const chatLog = log.scope('homeChatActions');

/** Chat runs from launch, so it hears about work it did not start. */
export async function startHomeChat(): Promise<void> {
  try {
    useChatStore.getState().adopt(await window.api.homeChat.start());
    useHomeChatStore.getState().set(await window.api.homeChat.list());
  } catch (error) {
    chatLog.error('chat failed to start', { error: String(error) });
  }
}

/** Shown at once, empty and starting; the agent comes up behind it. */
export async function newHomeChat(): Promise<void> {
  const store = useHomeChatStore.getState();
  const id = generateId(HOME_CHAT_ID_PREFIX.slice(0, -1));
  const previous = useChatStore.getState().sessions[store.currentId]?.info;
  useChatStore.getState().adopt({
    info: {
      id,
      role: 'home',
      agent: previous?.agent ?? 'claude',
      agentSessionId: null,
      projectPath: previous?.projectPath ?? '',
      cwd: previous?.cwd ?? '',
      worktreePath: null,
      sandbox: previous?.sandbox ?? null,
      taskId: null,
      status: 'starting',
      capabilities: NO_CAPABILITIES,
      models: [],
      efforts: [],
      modes: [],
      commands: [],
    },
    nodes: [],
    seq: 0,
  });
  store.set({ currentId: id, chats: store.chats, owners: store.owners });
  useAppStore.getState().select({ kind: 'chat', page: 'chat' });
  try {
    useChatStore.getState().adopt(await window.api.homeChat.create(id));
  } catch (error) {
    useProjectStore.getState().addToast(String(error), 'error');
  }
}

export async function deleteHomeChat(id: string): Promise<void> {
  try {
    useHomeChatStore.getState().set(await window.api.homeChat.delete(id));
    useChatStore.getState().forget(id);
  } catch (error) {
    useProjectStore.getState().addToast(String(error), 'error');
  }
}

/** Open one of Chat's conversations, resuming its agent in place of the current one's. */
export async function openHomeChat(id: string): Promise<void> {
  useAppStore.getState().select({ kind: 'chat', page: 'chat' });
  const store = useHomeChatStore.getState();
  if (id === store.currentId) return;
  // Shown at once, from its stored transcript; the agent catches up behind it.
  store.set({ currentId: id, chats: store.chats, owners: store.owners });
  try {
    useChatStore.getState().adopt(await window.api.homeChat.switch(id));
  } catch (error) {
    useProjectStore.getState().addToast(String(error), 'error');
  }
}

/** Its agent again on the same conversation, after it stopped or failed. */
export async function restartHomeChat(): Promise<void> {
  try {
    useChatStore.getState().adopt(await window.api.homeChat.restart());
  } catch (error) {
    useProjectStore.getState().addToast(String(error), 'error');
  }
}
