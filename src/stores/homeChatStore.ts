import { create } from 'zustand';
import { useAppStore } from './appStore';
import { useChatStore } from './chatStore';
import type { HomeChatState, HomeChatSummary } from '../chat/preferences';

interface HomeChatStore extends HomeChatState {
  /** Whether chat is turned on; until it is, Chat never starts and none of it shows. */
  enabled: boolean;
  /** Conversations whose work ended while they were not on screen. */
  unread: Record<string, true>;
  set: (state: HomeChatState) => void;
  setEnabled: (enabled: boolean) => void;
  markRead: (id: string) => void;
}

function onScreen(id: string, currentId: string): boolean {
  return id === currentId && useAppStore.getState().selection.kind === 'chat';
}

/** Chat's conversations, which one is current, and which started each task, as the main process reports them. */
export const useHomeChatStore = create<HomeChatStore>()((set) => ({
  currentId: '',
  chats: [],
  owners: {},
  following: {},
  enabled: false,
  unread: {},
  set: (state) =>
    set((before) => {
      const unread = { ...before.unread };
      for (const chat of state.chats) {
        const was = before.chats.find((c) => c.id === chat.id);
        if (was?.working && !chat.working && !onScreen(chat.id, state.currentId)) unread[chat.id] = true;
      }
      return { ...state, unread };
    }),
  setEnabled: (enabled) => set({ enabled }),
  markRead: (id) =>
    set((s) => {
      if (!s.unread[id]) return {};
      const { [id]: _read, ...unread } = s.unread;
      return { unread };
    }),
}));

export function currentHomeChatTitle(state: HomeChatState): string | undefined {
  return state.chats.find((chat: HomeChatSummary) => chat.id === state.currentId)?.title;
}

/** One of Chat's conversations, as the main process has said: by its listing, or its session's role. */
export function isHomeChat(id: string): boolean {
  const { currentId, chats } = useHomeChatStore.getState();
  return (
    id === currentId ||
    chats.some((chat) => chat.id === id) ||
    useChatStore.getState().sessions[id]?.info.role === 'home'
  );
}

export function useIsHomeChat(id: string): boolean {
  const listed = useHomeChatStore((s) => id === s.currentId || s.chats.some((chat) => chat.id === id));
  const role = useChatStore((s) => s.sessions[id]?.info.role);
  return listed || role === 'home';
}

let listening = false;

export function listenForHomeChat(): void {
  if (listening) return;
  listening = true;
  window.api.homeChat.onChanged((state) => useHomeChatStore.getState().set(state));
}
