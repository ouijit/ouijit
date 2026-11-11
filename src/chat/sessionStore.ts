import { getChatRepo } from '../db';
import type { ChatNodeWrite, ChatSessionRow } from '../db/repos/chatRepo';
import { isActiveSandbox, type SandboxProviderId } from '../sandbox/types';
import type { ChatAgentId, ChatNode, ChatSessionInfo, ChatSnapshot } from './model';

/** What survives a restart: the conversation's settings, not the live process state. */
export function persistedInfo(info: ChatSessionInfo): ChatSessionInfo {
  const status = info.status === 'error' ? 'error' : 'exited';
  return { ...info, status, statusDetail: info.status === 'error' ? info.statusDetail : undefined };
}

/** The row's columns win over the info it stores, which a client never writes but an older build did. */
export function storedInfo(row: ChatSessionRow): ChatSessionInfo {
  const info = JSON.parse(row.info) as ChatSessionInfo;
  return { ...info, role: row.role, agentSessionId: row.agent_session_id };
}

export function storedNodes(id: string): ChatNode[] {
  return getChatRepo()
    .nodes(id)
    .map((body) => JSON.parse(body) as ChatNode);
}

export function storedSnapshot(row: ChatSessionRow): ChatSnapshot {
  return { info: storedInfo(row), nodes: storedNodes(row.id), seq: row.seq };
}

export function storedRow(id: string): ChatSessionRow | undefined {
  return getChatRepo().get(id);
}

/** The stored row under a new agent or sandbox, written back so a later start without the options finds the same. */
export function reconfigured(
  row: ChatSessionRow,
  options: { agent: ChatAgentId; sandboxProvider?: SandboxProviderId },
): ChatSessionRow {
  const sandbox = isActiveSandbox(options.sandboxProvider) ? options.sandboxProvider : null;
  if (row.agent === options.agent && (row.sandbox_provider ?? null) === (options.sandboxProvider ?? null)) return row;
  const info = JSON.parse(row.info) as ChatSessionInfo;
  const next: ChatSessionRow = {
    ...row,
    agent: options.agent,
    sandbox_provider: options.sandboxProvider ?? null,
    agent_session_id: null,
    info: JSON.stringify({ ...info, agent: options.agent, sandbox, agentSessionId: null }),
  };
  getChatRepo().save(next, [], []);
  return next;
}

export function relabel(row: ChatSessionRow, label: string): void {
  const info = JSON.parse(row.info) as ChatSessionInfo;
  getChatRepo().save({ ...row, info: JSON.stringify({ ...info, label }) }, [], []);
}

/**
 * The writes a live session owes the store since its last flush. Nodes after
 * the first that moved are rewritten too, since their positions shifted.
 */
export function pendingWrites(nodes: ChatNode[], dirty: Set<string>, removed: Set<string>): ChatNodeWrite[] {
  const positions = new Map(nodes.map((node, index) => [node.id, index]));
  const upserts = [...dirty].flatMap((id) => {
    const position = positions.get(id);
    if (position === undefined) return [];
    return [{ nodeId: id, position, body: JSON.stringify(nodes[position]) }];
  });
  const firstChange = Math.min(...upserts.map((u) => u.position), removed.size ? 0 : Infinity);
  if (Number.isFinite(firstChange)) {
    const written = new Set(upserts.map((u) => u.nodeId));
    for (let index = firstChange; index < nodes.length; index++) {
      const node = nodes[index];
      if (!written.has(node.id)) upserts.push({ nodeId: node.id, position: index, body: JSON.stringify(node) });
    }
  }
  return upserts;
}
