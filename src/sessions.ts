import {
  getActiveSessions,
  getPtySpawnContext,
  getPtyTaskContext,
  isPtyActive,
  type ActiveSession,
} from './ptyManager';
import { getHookStatus } from './hookServer';
import { chatHost } from './chat/host';
import type { SandboxProviderId } from './types';
import { isSandboxProviderId } from './sandbox/types';

/**
 * A card's session is its PTY or its chat, under one id. What the CLI and the
 * hook server ask of "the calling terminal" has to hold for either, since an
 * agent in a chat card runs `ouijit` with the chat's id.
 */
export function isSessionLive(id: string): boolean {
  return isPtyActive(id) || chatHost.isLive(id);
}

export interface SessionContext {
  projectPath: string;
  taskId?: number;
  worktreePath?: string;
  sandboxProvider?: SandboxProviderId;
}

export function getSessionSpawnContext(id: string): SessionContext | null {
  const pty = getPtySpawnContext(id);
  if (pty) return pty;
  const chat = chatHost.list().find((info) => info.id === id);
  if (!chat) return null;
  return {
    projectPath: chat.projectPath,
    ...(chat.taskId != null && { taskId: chat.taskId }),
    ...(chat.worktreePath && { worktreePath: chat.worktreePath }),
    ...(isSandboxProviderId(chat.sandbox) && { sandboxProvider: chat.sandbox }),
  };
}

export function getSessionTaskContext(id: string): { projectPath: string; taskId: number } | null {
  if (isPtyActive(id)) return getPtyTaskContext(id);
  const chat = chatHost.context(id);
  return chat && chat.taskId != null ? { projectPath: chat.projectPath, taskId: chat.taskId } : null;
}

export interface SessionListing extends ActiveSession {
  surface: 'terminal' | 'chat';
  agentStatus: 'thinking' | 'ready' | null;
}

/** Every card's session: live PTYs and running chats. */
export function listSessions(): SessionListing[] {
  const ptys: SessionListing[] = getActiveSessions().map((session) => ({
    ...session,
    surface: 'terminal',
    agentStatus: getHookStatus(session.ptyId)?.status ?? null,
  }));
  const chats: SessionListing[] = chatHost
    .list()
    .filter((info) => !isPtyActive(info.id))
    .map((info) => ({
      ptyId: info.id,
      projectPath: info.projectPath,
      command: '',
      label: info.label ?? '',
      taskId: info.taskId ?? undefined,
      worktreePath: info.worktreePath ?? undefined,
      ...(isSandboxProviderId(info.sandbox) && { sandboxProvider: info.sandbox }),
      surface: 'chat',
      agentStatus:
        info.status === 'running' ? 'thinking' : info.status === 'idle' || info.status === 'awaiting' ? 'ready' : null,
    }));
  return [...ptys, ...chats];
}
