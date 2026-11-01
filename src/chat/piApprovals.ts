import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { getOuijitDir } from '../paths';

/**
 * Pi asks before nothing. This extension makes it ask before each tool call
 * when the user opts in, through pi's extension dialogs, which RPC mode sends
 * to us. The dialog title carries a JSON payload behind `ouijit-gate:` so the
 * pi driver can render it as an approval for that tool call; the option order
 * (allow, always, block) is what the driver reads.
 */
const PI_APPROVAL_EXTENSION = `// Ouijit approval gate for pi chat sessions. Auto-installed; Ouijit recreates it.
interface ToolCallEvent { toolName: string; toolCallId: string; input: Record<string, unknown> }
interface Context { hasUI: boolean; ui: { select(title: string, options: string[]): Promise<string | undefined> } }
interface Api { on(event: 'tool_call', handler: (event: ToolCallEvent, ctx: Context) => Promise<unknown>): void }

const READ_ONLY = new Set(['read', 'grep', 'find', 'ls']);

export default function (pi: Api) {
  const always = new Set<string>();
  pi.on('tool_call', async (event, ctx) => {
    if (!ctx.hasUI || READ_ONLY.has(event.toolName) || always.has(event.toolName)) return undefined;
    const subject = typeof event.input.command === 'string' ? event.input.command : String(event.input.path ?? '');
    const title = 'ouijit-gate:' + JSON.stringify({
      toolCallId: event.toolCallId,
      title: subject ? event.toolName + ': ' + subject : 'Run ' + event.toolName,
    });
    const choice = await ctx.ui.select(title, ['Allow', 'Always allow ' + event.toolName, 'Block']);
    if (choice === 'Allow') return undefined;
    if (choice && choice.startsWith('Always')) {
      always.add(event.toolName);
      return undefined;
    }
    return { block: true, reason: 'The user blocked this tool call.' };
  });
}
`;

export function getPiApprovalExtensionPath(): string {
  const file = path.join(getOuijitDir(), 'pi', 'ouijit-approvals.ts');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, PI_APPROVAL_EXTENSION);
  return file;
}
