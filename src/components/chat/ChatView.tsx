import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from '../terminal/terminalRegistry';
import { ChatNodeView, type NodeContext } from './ChatNodes';
import { ChatComposer } from './ChatComposer';
import { sendHeldPrompt } from './chatActions';
import type { ChatNode, ChatSessionInfo } from '../../chat/model';

const AGENT_LABELS: Record<ChatSessionInfo['agent'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  opencode: 'opencode',
  acp: 'ACP agent',
};

function useSession(cardId: string) {
  const session = useChatStore((s) => s.sessions[cardId]);
  useEffect(() => {
    if (session) return;
    void window.api.chat.snapshot(cardId).then((snapshot) => {
      if (snapshot && !useChatStore.getState().sessions[cardId]) useChatStore.getState().adopt(snapshot);
    });
  }, [cardId, session]);
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
      return <div className="text-[13px] text-text-tertiary">Starting {AGENT_LABELS[info.agent]}…</div>;
    case 'error':
    case 'exited':
      return (
        <div className="flex items-start gap-3 text-[13px]">
          <span
            className={`flex-1 whitespace-pre-wrap ${info.status === 'error' ? 'text-error' : 'text-text-tertiary'}`}
          >
            {info.statusDetail ?? `${AGENT_LABELS[info.agent]} stopped`}
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

export function ChatView({ cardId }: { cardId: string }) {
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
    <div className="flex-1 min-h-0 min-w-0 flex flex-col" style={{ background: 'var(--color-terminal-bg)' }}>
      <div ref={ref} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[52rem] px-6 pt-5 pb-4 flex flex-col gap-3">
          {top.length === 0 && info.status !== 'starting' && (
            <div className="text-sm text-text-tertiary">{AGENT_LABELS[info.agent]} is ready.</div>
          )}
          {top.map((node) => (
            <ChatNodeView key={node.id} node={node} context={context} />
          ))}
          {info.status === 'running' && (
            <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
              <span
                className="w-2 h-2 rounded-full border-[1.5px] border-ink/25 border-t-ink/70"
                style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
              />
              Working
            </div>
          )}
          <StatusLine info={info} cardId={cardId} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[52rem]">
        <ChatComposer cardId={cardId} info={info} focusRef={setFocus} />
      </div>
    </div>
  );
}
