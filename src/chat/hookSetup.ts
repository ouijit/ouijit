/**
 * Agents a start hook might launch. In a chat card the chat is the agent, so a
 * hook that launches one as well would leave two of them, and the chat's first
 * message waits for a setup that never ends.
 */
const AGENT_COMMANDS = new Set([
  'claude',
  'codex',
  'pi',
  'opencode',
  'gemini',
  'aider',
  'amp',
  'cursor-agent',
  'goose',
  'qwen',
  'crush',
]);

/** Split on `&&` and `;` outside quotes, keeping each separator with the part before it. */
function splitTopLevel(command: string): { part: string; separator: string }[] {
  const parts: { part: string; separator: string }[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') {
      i++;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ';' || c === '\n' || (c === '&' && command[i + 1] === '&')) {
      const separator = c === '&' ? '&&' : c;
      parts.push({ part: command.slice(start, i), separator });
      if (c === '&') i++;
      start = i + 1;
    }
  }
  parts.push({ part: command.slice(start), separator: '' });
  return parts;
}

/** The program a simple command runs, past `VAR=value`, `exec`, `env` and `npx`-style launchers. */
function program(part: string): string | null {
  const words = part.trim().split(/\s+/);
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || ['exec', 'env', 'command', 'npx', 'bunx', 'time'].includes(word)) {
      i++;
      continue;
    }
    break;
  }
  const word = words[i];
  if (!word) return null;
  return (
    word
      .replace(/^['"]|['"]$/g, '')
      .split('/')
      .pop() ?? null
  );
}

/**
 * What of a start or continue hook to run before a chat card's first message:
 * everything up to the part that launches an agent, or the whole hook when it
 * launches none. Null when nothing is left to run.
 */
export function chatSetupCommand(command: string): string | null {
  const parts = splitTopLevel(command);
  const agentAt = parts.findIndex(({ part }) => {
    const name = program(part);
    return name !== null && AGENT_COMMANDS.has(name);
  });
  const kept = agentAt === -1 ? parts : parts.slice(0, agentAt);
  const setup = kept
    .map(({ part, separator }, index) => (index === kept.length - 1 ? part : `${part}${separator}`))
    .join('')
    .trim();
  return setup || null;
}
