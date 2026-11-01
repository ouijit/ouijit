import { create } from 'zustand';
import log from 'electron-log/renderer';
import {
  applyChatEvent,
  type ChatNode,
  type ChatSessionInfo,
  type ChatSnapshot,
  type SequencedChatEvent,
} from '../chat/model';

const chatLog = log.scope('chatStore');

interface ChatSessionState {
  info: ChatSessionInfo;
  nodes: ChatNode[];
  seq: number;
}

/** The first prompt of a task's chat, held until its setup hook has run. */
export type SetupState = { text: string; status: 'running' | 'failed' };

interface ChatStore {
  sessions: Record<string, ChatSessionState>;
  setup: Record<string, SetupState>;
  /** Unsent composer text per card, which `ouijit` and a switch between surfaces both preserve. */
  drafts: Record<string, string>;
  adopt: (snapshot: ChatSnapshot) => void;
  apply: (id: string, event: SequencedChatEvent) => void;
  forget: (id: string) => void;
  setSetup: (id: string, setup: SetupState | null) => void;
  setDraft: (id: string, text: string) => void;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  sessions: {},
  setup: {},
  drafts: {},

  adopt: (snapshot) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [snapshot.info.id]: { info: snapshot.info, nodes: snapshot.nodes, seq: snapshot.seq },
      },
    })),

  apply: (id, { seq, event }) => {
    const current = get().sessions[id];
    if (!current || seq <= current.seq) return;
    if (seq !== current.seq + 1) {
      void resync(id, current.seq);
      return;
    }
    const next = { info: current.info, nodes: [...current.nodes] };
    applyChatEvent(next, event);
    set((s) => ({ sessions: { ...s.sessions, [id]: { ...next, seq } } }));
  },

  forget: (id) =>
    set((s) => {
      const { [id]: _session, ...sessions } = s.sessions;
      const { [id]: _setup, ...setup } = s.setup;
      return { sessions, setup };
    }),

  setSetup: (id, setup) =>
    set((s) => {
      if (setup) return { setup: { ...s.setup, [id]: setup } };
      const { [id]: _removed, ...rest } = s.setup;
      return { setup: rest };
    }),

  setDraft: (id, text) => set((s) => ({ drafts: { ...s.drafts, [id]: text } })),
}));

const resyncing = new Set<string>();

/** A gap in sequence numbers means events were missed: replay what the host still holds, or take a fresh snapshot. */
async function resync(id: string, after: number): Promise<void> {
  if (resyncing.has(id)) return;
  resyncing.add(id);
  try {
    const missed = await window.api.chat.since(id, after);
    if (missed) {
      for (const event of missed) useChatStore.getState().apply(id, event);
    } else {
      const snapshot = await window.api.chat.snapshot(id);
      if (snapshot) useChatStore.getState().adopt(snapshot);
    }
  } catch (error) {
    chatLog.warn('chat resync failed', { id, error: String(error) });
  } finally {
    resyncing.delete(id);
  }
}

let listening = false;

/** Feed every chat event from the main process into the store. Once per window. */
export function listenForChatEvents(onEvent?: (id: string, event: SequencedChatEvent) => void): void {
  if (listening) return;
  listening = true;
  window.api.chat.onEvent((id, event) => {
    useChatStore.getState().apply(id, event);
    onEvent?.(id, event);
  });
}
