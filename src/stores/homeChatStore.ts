import { create } from 'zustand';
import type { HomeChatState, HomeChatSummary } from '../chat/preferences';

interface HomeChatStore extends HomeChatState {
  /** Which conversation started each task, by `project#number`, so what its worker waits on shows there. */
  owners: Record<string, string>;
  set: (state: HomeChatState) => void;
  own: (projectPath: string, taskNumber: number, conversation: string) => void;
}

export const taskKey = (projectPath: string, taskNumber: number) => `${projectPath}#${taskNumber}`;

/** Chat's conversations and which one is current, as the main process reports them. */
export const useHomeChatStore = create<HomeChatStore>()((set) => ({
  currentId: '',
  chats: [],
  owners: {},
  set: (state) => set(state),
  own: (projectPath, taskNumber, conversation) =>
    set((s) => ({ owners: { ...s.owners, [taskKey(projectPath, taskNumber)]: conversation } })),
}));

export function currentHomeChatTitle(state: HomeChatState): string | undefined {
  return state.chats.find((chat: HomeChatSummary) => chat.id === state.currentId)?.title;
}

let listening = false;

export function listenForHomeChat(onConfirm: Parameters<typeof window.api.homeChat.onConfirm>[0]): void {
  if (listening) return;
  listening = true;
  window.api.homeChat.onChanged((state) => useHomeChatStore.getState().set(state));
  window.api.homeChat.onConfirm(onConfirm);
}
