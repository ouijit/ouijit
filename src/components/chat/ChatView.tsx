import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances } from '../terminal/terminalRegistry';
import { ChatNodeList, type NodeContext } from './ChatNodes';
import { ChatTurns } from './ChatTurns';
import { ChatBackground } from './ChatBackground';
import { ChatComposer } from './ChatComposer';
import { StatusGlyph } from '../terminal/StatusDot';
import { sendHeldPrompt } from './chatActions';
import { CHAT_AGENT_LABELS } from '../../chat/preferences';
import { restartHomeChat } from './homeChatActions';
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

/**
 * Follow new output while the reader is at the bottom; leave them be once
 * they scroll up. Output grows between node events too, as a message is
 * revealed, so this follows the content's height rather than the nodes.
 *
 * Only a move up lets go. The scroll event from following lands a frame
 * later, by when more may have arrived, so "how far from the bottom" alone
 * would read new output as the reader having scrolled away.
 */
function useStickToBottom(loaded: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom) pinned.current = true;
    else if (el.scrollTop < lastTop.current) pinned.current = false;
    lastTop.current = el.scrollTop;
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    const inner = content.current;
    if (!el || !inner) return;
    const follow = () => {
      if (!pinned.current) return;
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    };
    follow();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(follow);
    observer.observe(inner);
    observer.observe(el);
    return () => observer.disconnect();
  }, [loaded]);
  return { ref, content, onScroll };
}

function StatusLine({ info, cardId, quiet }: { info: ChatSessionInfo; cardId: string; quiet: boolean }) {
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
      // On the Chat page the composer is already there to type into; the agent takes what is sent once up.
      if (quiet) return null;
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
          <button type="button" className="btn-secondary btn-compact shrink-0" onClick={() => void restart(info)}>
            Restart
          </button>
        </div>
      );
    default:
      return null;
  }
}

async function restart(info: ChatSessionInfo): Promise<void> {
  if (info.role === 'home') return restartHomeChat();
  const cardId = info.id;
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
export function ChatView({
  cardId,
  surface = 'card',
  footer,
}: {
  cardId: string;
  surface?: 'card' | 'page';
  /** After the transcript, as part of it: what the conversation waits on the user for. */
  footer?: ReactNode;
}) {
  const session = useSession(cardId);
  const nodes = session?.nodes;
  const { ref, content, onScroll } = useStickToBottom(Boolean(session));

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
      // On its own page a conversation is what you came to type into.
      if (surface === 'page') {
        focus?.();
        return;
      }
      const term = terminalInstances.get(cardId);
      if (term) term.chatFocus = focus;
    },
    [cardId, surface],
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
      <div ref={ref} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto [overflow-anchor:none]">
        <div ref={content} className="mx-auto max-w-[52rem] px-6 pt-14 pb-4 flex flex-col gap-3">
          {surface === 'card' && top.length === 0 && info.status !== 'starting' && (
            <div className="text-sm text-text-tertiary">{CHAT_AGENT_LABELS[info.agent]} is ready.</div>
          )}
          {surface === 'page' ? (
            <ChatTurns nodes={top} context={context} busy={info.status === 'running' || info.status === 'awaiting'} />
          ) : (
            <ChatNodeList nodes={top} context={context} fold />
          )}
          {surface === 'card' && info.status === 'running' && (
            <div className="flex items-center h-5" role="status" aria-label="Working">
              <StatusGlyph status="thinking" size={8} />
            </div>
          )}
          <StatusLine info={info} cardId={cardId} quiet={surface === 'page'} />
          {footer}
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
