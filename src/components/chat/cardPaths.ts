import { terminalInstances } from '../terminal/terminalRegistry';
import { useChatStore } from '../../stores/chatStore';

/** `text` with paths under the card's folder written relative to it: its worktree, else the chat's own folder. */
export function relativeToCard(text: string, cardId: string): string {
  const root = terminalInstances.get(cardId)?.worktreePath ?? useChatStore.getState().sessions[cardId]?.info.cwd;
  return root ? text.split(`${root}/`).join('') : text;
}
