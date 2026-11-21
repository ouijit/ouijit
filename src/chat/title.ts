import type { AgentProcess, AgentSpawn } from '../agents';
import { exited, onLines, terminate } from '../agents';

const TITLE_TIMEOUT_MS = 30_000;
const MAX_TITLE = 60;

export function titlePrompt(message: string): string {
  return [
    'Write a title of two to five words for a conversation that opens with the message below. Reply with the title alone.',
    '',
    '<message>',
    message.slice(0, 2000),
    '</message>',
  ].join('\n');
}

/** The last line an agent printed, as a title: no quotes, markup or closing full stop. Null for nothing usable. */
export function cleanTitle(output: string): string | null {
  const line = output
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  const title = line
    .replace(/^(title:\s*)/i, '')
    .replace(/[*_`#]/g, '')
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .replace(/[.!]+$/, '')
    .trim();
  return title && title.length <= MAX_TITLE ? title : null;
}

/** Runs an agent's one-shot and reads its answer as a title. Null if it fails, is slow, or says nothing usable. */
export async function generateTitle(
  spawn: (spawn: AgentSpawn) => Promise<AgentProcess>,
  oneShot: AgentSpawn,
): Promise<string | null> {
  let proc: AgentProcess;
  try {
    proc = await spawn(oneShot);
  } catch {
    return null;
  }
  // Claude reads a piped stdin as more of the prompt, and waits for it to close.
  proc.stdin.end();
  const lines: string[] = [];
  onLines(proc.stdout, (line) => lines.push(line));
  const timer = setTimeout(() => void terminate(proc), TITLE_TIMEOUT_MS);
  const ended = new Promise<void>((resolve) => proc.stdout.once('end', () => resolve()));
  const code = await exited(proc);
  clearTimeout(timer);
  // The last of stdout can land after the exit.
  await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 500))]);
  return code === 0 ? cleanTitle(lines.join('\n')) : null;
}
