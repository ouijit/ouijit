import { create } from 'zustand';
import { useChatStore } from './chatStore';
import type { HomeChatState, HomeChatSummary, TaskSurface } from '../chat/preferences';

interface HomeChatStore extends HomeChatState {
  /** Whether chat is turned on; until it is, Chat never starts and none of it shows. */
  enabled: boolean;
  /** What resuming a task opens, by the chat setting. */
  taskSurface: TaskSurface;
  set: (state: HomeChatState) => void;
  setEnabled: (enabled: boolean) => void;
  setTaskSurface: (surface: TaskSurface) => void;
}

/** Chat's conversations, which one is current, and which started each task, as the main process reports them. */
export const useHomeChatStore = create<HomeChatStore>()((set) => ({
  currentId: '',
  chats: [],
  owners: {},
  enabled: false,
  taskSurface: 'terminal',
  set: (state) => set(state),
  setEnabled: (enabled) => set({ enabled }),
  setTaskSurface: (taskSurface) => set({ taskSurface }),
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
