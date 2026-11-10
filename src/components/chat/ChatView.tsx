import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances } from '../terminal/terminalRegistry';
import { ChatNodeList, type NodeContext } from './ChatNodes';
import { ChatBackground } from './ChatBackground';
import { ChatComposer } from './ChatComposer';
import { StatusGlyph } from '../terminal/StatusDot';
import { sendHeldPrompt } from './chatActions';
import { CHAT_AGENT_LABELS, isHomeChatId } from '../../chat/preferences';
import type { ChatNode, ChatSessionInfo } from '../../chat/model';

function useSession(cardId: string) {
  const session = useChatStore((s) => s.sessions[cardId]);
  useEffect(() => {
    if (session) return;
    void window.api.chat.snapshot(cardId).then((snapshot) => {
      if (snapshot && !useChatStore.getState().sessions[cardId]) useChatStore.getState().adopt(snapshot);
    });
  }, [cardId, session]);
  // Handing the conversation to the terminal stops the chat's agent, and this
  // view stays up until the terminal has drawn: that stop is not an ending.
  const handingOff = useTerminalStore((s) => {
    const display = s.displayStates[cardId];
    return display?.switching === 'terminal' || (display?.surface ?? 'chat') !== 'chat';
  });
  if (session && handingOff && session.info.status === 'exited') {
    return { ...session, info: { ...session.info, status: 'idle' as const } };
  }
  return session;
}

/** Follow new output while the reader is at the bottom; leave them be once they scroll up. */
function useStickToBottom(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [dependency]);
  return { ref, onScroll };
}

function StatusLine({ info, cardId }: { info: ChatSessionInfo; cardId: string }) {
  const held = useChatStore((s) => s.setup[cardId]);
  if (held?.status === 'running') {
    return (
      <div className="text-[13px] text-text-tertiary">Running setup. The task goes to the agent once it succeeds.</div>
    );
  }
  if (held?.status === 'failed') {
    return (
      <div className="flex items-center gap-3 text-[13px] text-text-secondary">
        <span>Setup failed, so the task has not been sent.</span>
        <button type="button" className="btn-secondary btn-compact" onClick={() => void sendHeldPrompt(cardId)}>
          Send anyway
        </button>
      </div>
    );
  }
  switch (info.status) {
    case 'starting':
      return <div className="text-[13px] text-text-tertiary">Starting {CHAT_AGENT_LABELS[info.agent]}…</div>;
    case 'error':
    case 'exited':
      return (
        <div className="flex items-start gap-3 text-[13px]">
          <span
            className={`flex-1 whitespace-pre-wrap ${info.status === 'error' ? 'text-error' : 'text-text-tertiary'}`}
          >
            {info.statusDetail ?? `${CHAT_AGENT_LABELS[info.agent]} stopped`}
          </span>
          <button type="button" className="btn-secondary btn-compact shrink-0" onClick={() => void restart(cardId)}>
            Restart
          </button>
        </div>
      );
    default:
      return null;
  }
}

async function restart(cardId: string): Promise<void> {
  if (isHomeChatId(cardId)) {
    try {
      useChatStore.getState().adopt(await window.api.homeChat.restart());
    } catch (error) {
      useProjectStore.getState().addToast(String(error), 'error');
    }
    return;
  }
  const term = terminalInstances.get(cardId);
  if (!term) return;
  try {
    await window.api.chat.stop(cardId);
    const snapshot = await window.api.chat.start({
      id: cardId,
      agent: term.chatAgent ?? 'claude',
      projectPath: term.projectPath,
      cwd: term.worktreePath ?? term.projectPath,
      taskId: term.taskId,
      worktreePath: term.worktreePath,
      sandboxProvider: term.sandboxProvider,
    });
    useChatStore.getState().adopt(snapshot);
  } catch (error) {
    useProjectStore.getState().addToast(String(error), 'error');
  }
}

/** `page` sits on the window's own background, as the board does; `card` is the surface inside a terminal card. */
export function ChatView({ cardId, surface = 'card' }: { cardId: string; surface?: 'card' | 'page' }) {
  const session = useSession(cardId);
  const nodes = session?.nodes;
  const { ref, onScroll } = useStickToBottom(nodes);

  const children = useMemo(() => {
    const map = new Map<string | null, ChatNode[]>();
    for (const node of nodes ?? []) {
      const parent = node.parentId && nodes?.some((n) => n.id === node.parentId) ? node.parentId : null;
      const list = map.get(parent) ?? [];
      list.push(node);
      map.set(parent, list);
    }
    return map;
  }, [nodes]);

  const setFocus = useCallback(
    (focus: (() => void) | null) => {
      const term = terminalInstances.get(cardId);
      if (term) term.chatFocus = focus;
    },
    [cardId],
  );

  const info = session?.info;
  const context: NodeContext = useMemo(
    () => ({
      cardId,
      children,
      canRewind: Boolean(info?.capabilities.rewind && info.status === 'idle'),
      onRewind: (nodeId) => {
        void window.api.chat
          .rewind(cardId, nodeId)
          .catch((error: unknown) => useProjectStore.getState().addToast(String(error), 'error'));
      },
    }),
    [cardId, children, info?.capabilities.rewind, info?.status],
  );

  if (!session || !info) {
    return <div className="flex-1 flex items-center justify-center text-sm text-text-tertiary">Loading chat…</div>;
  }

  const top = children.get(null) ?? [];
  return (
    <div
      className="flex-1 min-h-0 min-w-0 flex flex-col"
      style={{ background: surface === 'page' ? 'var(--color-background)' : 'var(--color-terminal-bg)' }}
    >
      {surface === 'page' && (
        <div
          className="pointer-events-none h-6 shrink-0 -mb-6 relative z-10"
          style={{ background: 'linear-gradient(to bottom, var(--color-background), transparent)' }}
        />
      )}
      <div ref={ref} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[52rem] px-6 pt-14 pb-4 flex flex-col gap-3">
          {top.length === 0 && info.status !== 'starting' && (
            <div className="text-sm text-text-tertiary">{CHAT_AGENT_LABELS[info.agent]} is ready.</div>
          )}
          <ChatNodeList nodes={top} context={context} fold />
          {info.status === 'running' && (
            <div className="flex items-center h-5" role="status" aria-label="Working">
              <StatusGlyph status="thinking" size={8} />
            </div>
          )}
          <StatusLine info={info} cardId={cardId} />
        </div>
      </div>
      {surface === 'page' && (
        <div
          className="pointer-events-none h-6 shrink-0 -mt-6 relative z-10"
          style={{ background: 'linear-gradient(to top, var(--color-background), transparent)' }}
        />
      )}
      <div className="mx-auto w-full max-w-[52rem]">
        <ChatBackground cardId={cardId} info={info} />
        <ChatComposer cardId={cardId} info={info} focusRef={setFocus} />
      </div>
    </div>
  );
}
