import { getLogger } from '../logger';
import { getChatRepo } from '../db';
import type { ChatSessionRow } from '../db/repos/chatRepo';
import { pendingWrites, persistedInfo } from './sessionStore';
import type { SandboxSpec } from '../sandbox/types';
import type { AgentProcess, DriverSession } from '../agents';
import {
  applyChatEvent,
  type ChatAnswer,
  type ChatEvent,
  type ChatNode,
  type ChatSessionInfo,
  type ChatSnapshot,
  type RequestNode,
  type SequencedChatEvent,
  type UserMessageNode,
} from './model';

export const chatLog = getLogger().scope('chat');

const FLUSH_DELAY_MS = 300;
/** Events kept for a client catching up; one that falls further behind takes a fresh snapshot. */
const REPLAY_WINDOW = 4000;

export type ChatListener = (sessionId: string, event: SequencedChatEvent) => void;

/**
 * Nodes still running once their agent process is gone, settled: nothing will
 * report them finished. A subagent whose launching call completed is done.
 */
export function settled(nodes: ChatNode[]): ChatNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.flatMap((node) => {
    if (node.kind === 'request' || !('status' in node)) return [];
    if (node.status !== 'running' && node.status !== 'pending') return [];
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const done = node.kind === 'subagent' && parent?.kind === 'tool_call' && parent.status === 'completed';
    return [{ ...node, status: done ? 'completed' : 'interrupted' } as ChatNode];
  });
}

interface Pending {
  resolve: (answer: ChatAnswer) => void;
}

export class HostedSession {
  info: ChatSessionInfo;
  nodes: ChatNode[] = [];
  seq = 0;
  driver: DriverSession | null = null;
  readonly asks = new Map<string, Pending>();
  readonly queued: UserMessageNode[] = [];
  /**
   * Messages handed to the agent mid-turn that it has not read yet, kept last:
   * what it writes before reading one is not a reply to it. True once the turn
   * it was sent into has ended, so it opens the next one instead of steering.
   */
  readonly unread = new Map<string, boolean>();
  private readonly recent: SequencedChatEvent[] = [];
  private dirty = new Set<string>();
  private removed = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly createdAt: string;
  readonly processes = new Set<AgentProcess>();
  starting: Promise<void> | null = null;
  stopping: Promise<void> | null = null;
  referenceEnv: Record<string, string> = {};
  instructions = '';
  launchMode: string | undefined;

  constructor(
    readonly row: Pick<ChatSessionRow, 'id' | 'project_path' | 'task_id' | 'cwd' | 'worktree_path' | 'agent'> & {
      sandbox: SandboxSpec | null;
    },
    info: ChatSessionInfo,
    createdAt: string,
    private readonly broadcast: ChatListener,
  ) {
    this.info = info;
    this.createdAt = createdAt;
  }

  emit(event: ChatEvent): void {
    const appended =
      event.type === 'node' && !this.unread.has(event.node.id) && !this.nodes.some((n) => n.id === event.node.id);
    applyChatEvent(this, event);
    const sequenced = { seq: ++this.seq, event };
    this.recent.push(sequenced);
    if (this.recent.length > REPLAY_WINDOW) this.recent.splice(0, this.recent.length - REPLAY_WINDOW);
    this.track(event);
    this.broadcast(this.info.id, sequenced);
    if (appended && this.unread.size > 0) this.keepUnreadLast();
  }

  private keepUnreadLast(): void {
    const ids = [...this.unread.keys()];
    const nodes = ids.flatMap((id) => this.nodes.filter((node) => node.id === id));
    this.emit({ type: 'remove', ids });
    for (const node of nodes) this.emit({ type: 'node', node });
  }

  /** The agent has read a message it was sent mid-turn: it stays where it is, last, and what follows answers it. */
  read(id: string): void {
    const turnEnded = this.unread.get(id);
    if (turnEnded === undefined) return;
    this.unread.delete(id);
    const node = this.nodes.find((n): n is UserMessageNode => n.id === id && n.kind === 'user_message');
    if (node && (turnEnded || node.delivery === 'queued')) {
      this.emit({ type: 'node', node: { ...node, delivery: 'prompt' } });
    }
  }

  since(seq: number): SequencedChatEvent[] | null {
    if (seq >= this.seq) return [];
    const first = this.recent[0];
    if (!first || first.seq > seq + 1) return null;
    return this.recent.filter((entry) => entry.seq > seq);
  }

  snapshot(): ChatSnapshot {
    return { info: this.info, nodes: this.nodes, seq: this.seq };
  }

  async readyDriver(): Promise<DriverSession> {
    await this.starting;
    if (!this.driver) throw new Error(this.info.statusDetail ?? 'The agent is not running');
    return this.driver;
  }

  answer(requestId: string, answer: ChatAnswer, { byChat = false } = {}): boolean {
    const pending = this.asks.get(requestId);
    const node = this.nodes.find((n): n is RequestNode => n.id === requestId && n.kind === 'request');
    if (!pending || !node) return false;
    this.asks.delete(requestId);
    this.emit({
      type: 'node',
      node: { ...node, status: answer.kind === 'cancel' ? 'cancelled' : 'answered', answer, ...(byChat && { byChat }) },
    });
    if (this.asks.size === 0 && this.info.status === 'awaiting') {
      this.emit({ type: 'session', patch: { status: 'running' } });
    }
    pending.resolve(answer);
    return true;
  }

  cancelAsks(): void {
    for (const requestId of [...this.asks.keys()]) this.answer(requestId, { kind: 'cancel' });
  }

  private track(event: ChatEvent): void {
    if (event.type === 'node') {
      this.dirty.add(event.node.id);
      this.removed.delete(event.node.id);
    } else if (event.type === 'append') {
      this.dirty.add(event.id);
    } else if (event.type === 'remove') {
      for (const id of event.ids) {
        this.dirty.delete(id);
        this.removed.add(id);
      }
    }
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const upserts = pendingWrites(this.nodes, this.dirty, this.removed);
    try {
      getChatRepo().save(
        {
          ...this.row,
          sandbox: this.row.sandbox && JSON.stringify(this.row.sandbox),
          role: this.info.role,
          agent_session_id: this.info.agentSessionId,
          info: JSON.stringify(persistedInfo(this.info)),
          seq: this.seq,
          created_at: this.createdAt,
          updated_at: new Date().toISOString(),
        },
        upserts,
        [...this.removed],
      );
      this.dirty.clear();
      this.removed.clear();
    } catch (error) {
      chatLog.error('failed to persist chat session', { id: this.info.id, error: String(error) });
    }
  }
}
