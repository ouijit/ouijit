import type { Script } from '../../types';

export interface ScriptDraft {
  name: string;
  command: string;
  restartIfRunning: boolean;
}

export function scriptFromDraft(draft: ScriptDraft, existing?: Script): Script | null {
  const name = draft.name.trim();
  const command = draft.command.trim();
  if (!name || !command) return null;
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    command,
    sortOrder: existing?.sortOrder ?? 0,
    restartIfRunning: draft.restartIfRunning,
  };
}
