import { isConversationCommand, type ChatCommand, type ChatSessionInfo } from './model';

export type MenuItem =
  | { kind: 'command'; command: ChatCommand; takesArgument: boolean }
  | { kind: 'option'; command: 'model' | 'effort'; id: string; label: string; description?: string };

/** Ouijit's own commands come first in the menu, in this order; they are the ones used most. */
const PINNED = ['clear', 'compact', 'model', 'effort'];

/**
 * Whether choosing a command should wait for more before it runs: it needs an
 * argument, or offers choices (a model, an effort). An argument agents mark
 * optional, in brackets or by saying so, does not hold it back.
 */
function takesArgument(command: ChatCommand): boolean {
  if (command.name === 'model' || command.name === 'effort') return true;
  const hint = command.argumentHint?.trim();
  return Boolean(hint) && !hint!.startsWith('[') && !/optional/i.test(hint!);
}

function descriptionMatches(description: string, query: string): boolean {
  return description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => word.startsWith(query));
}

/**
 * How well a command matches what was typed after the slash: the start of its
 * name, the start of the part after a plugin's prefix (`plugin:command`), its
 * name anywhere, then its description. Null for no match.
 */
function rank(command: ChatCommand, query: string): number | null {
  if (!query) return 0;
  const name = command.name.toLowerCase();
  if (name.startsWith(query)) return 0;
  const local = name.slice(name.lastIndexOf(':') + 1);
  if (local.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  // A description matches on whole words being typed, and only once there is enough to mean something.
  if (query.length >= 3 && command.description && descriptionMatches(command.description, query)) return 3;
  return null;
}

/**
 * What the composer's menu offers for a draft: the commands matching a
 * `/word` being typed, or, once `/model ` or `/effort ` is typed, that
 * setting's choices. Empty for anything else.
 */
export function commandMenu(draft: string, info: Pick<ChatSessionInfo, 'commands' | 'models' | 'efforts'>): MenuItem[] {
  const option = /^\/(model|effort)\s+(\S*)$/.exec(draft);
  if (option) {
    const which = option[1] as 'model' | 'effort';
    const query = option[2].toLowerCase();
    const choices = which === 'model' ? info.models : info.efforts;
    return choices
      .filter((c) => !query || c.id.toLowerCase().includes(query) || c.label.toLowerCase().includes(query))
      .map((c) => ({ kind: 'option', command: which, id: c.id, label: c.label, description: c.description }));
  }
  const typed = /^\/(\S*)$/.exec(draft);
  if (!typed) return [];
  const query = typed[1].toLowerCase();
  return info.commands
    .map((command, index) => ({ command, index, score: rank(command, query) }))
    .filter((entry): entry is { command: ChatCommand; index: number; score: number } => entry.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const pa = isConversationCommand(a.command.name) ? PINNED.indexOf(a.command.name) : -1;
      const pb = isConversationCommand(b.command.name) ? PINNED.indexOf(b.command.name) : -1;
      if ((pa === -1) !== (pb === -1)) return pa === -1 ? 1 : -1;
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    })
    .map(({ command }) => ({ kind: 'command', command, takesArgument: takesArgument(command) }));
}
