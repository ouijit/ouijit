import { getPtyTaskContext, isPtyActive } from './ptyManager';
import { chatHost } from './chat/host';

/**
 * A card's session is its PTY or its chat, under one id. What the CLI and the
 * hook server ask of "the calling terminal" has to hold for either, since an
 * agent in a chat card runs `ouijit` with the chat's id.
 */
export function isSessionLive(id: string): boolean {
  return isPtyActive(id) || chatHost.isLive(id);
}

export function getSessionTaskContext(id: string): { projectPath: string; taskId: number } | null {
  const pty = getPtyTaskContext(id);
  if (pty) return pty;
  const chat = chatHost.context(id);
  return chat && chat.taskId != null ? { projectPath: chat.projectPath, taskId: chat.taskId } : null;
}
