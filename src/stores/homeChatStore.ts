import { create } from 'zustand';
import type { HomeChatState, HomeChatSummary } from '../chat/preferences';

interface HomeChatStore extends HomeChatState {
  set: (state: HomeChatState) => void;
}

/** Chat's conversations and which one is current, as the main process reports them. */
export const useHomeChatStore = create<HomeChatStore>()((set) => ({
  currentId: '',
  chats: [],
  set: (state) => set(state),
}));

export function currentHomeChatTitle(state: HomeChatState): string | undefined {
  return state.chats.find((chat: HomeChatSummary) => chat.id === state.currentId)?.title;
}

let listening = false;

export function listenForHomeChat(): void {
  if (listening) return;
  listening = true;
  window.api.homeChat.onChanged((state) => useHomeChatStore.getState().set(state));
}
