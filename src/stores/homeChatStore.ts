import { create } from 'zustand';
import { useChatStore } from './chatStore';
import type { HomeChatState, HomeChatSummary } from '../chat/preferences';

interface HomeChatStore extends HomeChatState {
  set: (state: HomeChatState) => void;
}

/** Chat's conversations, which one is current, and which started each task, as the main process reports them. */
export const useHomeChatStore = create<HomeChatStore>()((set) => ({
  currentId: '',
  chats: [],
  owners: {},
  set: (state) => set(state),
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
