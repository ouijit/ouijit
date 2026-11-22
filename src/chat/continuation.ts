import { chatHost } from './host';
import { transcriptText, type ChatNode } from './model';

export const CONTINUATION_BUDGET_CHARS = 40_000;

interface Task {
  projectPath: string;
  taskNumber: number;
  name: string;
}

export type ContinuationPrompt = { prompt: string } | { status: 400 | 404; error: string };

/**
 * A new chat's first message, carrying on chat `from`'s conversation on the
 * same task. From Ouijit's transcript rather than the agent's own fork, since
 * the new chat may run a different agent.
 */
export function continuationPrompt(from: string, task: Task, prompt: string | undefined): ContinuationPrompt {
  const source = chatHost.snapshot(from);
  if (!source) return { status: 404, error: `Chat ${from} not found` };
  if (source.info.projectPath !== task.projectPath || source.info.taskId !== task.taskNumber) {
    return { status: 400, error: `Chat ${from} is not on task ${task.taskNumber}` };
  }
  const { text, trimmed } = recentTranscript(source.nodes);
  return {
    prompt: [
      `You are taking over from another agent (${source.info.agent}) that has been working on task ${task.taskNumber}, "${task.name}", in this same worktree. Its changes are already here, and it may still be running, so check the current state before you act on anything it said.`,
      'Its conversation so far follows. Lines starting with "> " are messages to it, and a line like "[completed] Run npm test" is a tool step and how it ended.',
      trimmed ? 'Earlier parts of the conversation were left out; this is the most recent part.' : null,
      `<conversation>\n${text}\n</conversation>`,
      prompt ?? 'Carry on from where it left off.',
    ]
      .filter((part) => part !== null)
      .join('\n\n'),
  };
}

function recentTranscript(nodes: ChatNode[]): { text: string; trimmed: boolean } {
  const blocks = nodes.map((node) => transcriptText([node])).filter(Boolean);
  const kept: string[] = [];
  let length = 0;
  for (let index = blocks.length - 1; index >= 0; index--) {
    length += blocks[index].length + 2;
    if (length > CONTINUATION_BUDGET_CHARS) break;
    kept.unshift(blocks[index]);
  }
  if (kept.length === 0 && blocks.length > 0) kept.push(blocks[blocks.length - 1].slice(-CONTINUATION_BUDGET_CHARS));
  const text = kept.join('\n\n');
  return { text, trimmed: text.length < blocks.join('\n\n').length };
}
