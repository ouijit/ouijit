import { shellJoin } from '../utils/shellQuote';

/**
 * JSON output helpers for the CLI.
 * All commands output JSON to stdout. Errors go to stderr.
 */

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * A refusal from the API, with the `ouijit ask run` line that would ask the
 * user to run the same command outside the sandbox. An ask is never offered
 * for an ask, or for a command reading stdin, which the ask cannot carry.
 */
export function forbiddenMessage(reason: string, argv: string[]): string {
  const why =
    reason === 'Forbidden' ? "this terminal's sandbox does not allow it at the project's Ouijit CLI access" : reason;
  if (argv[0] === 'ask' || argv.includes('-')) return `Forbidden: ${why}`;
  return `Forbidden: ${why}. To ask the user to run it outside the sandbox: ouijit ask run -m "<why>" -- ${shellJoin(['ouijit', ...argv])}`;
}

export function printError(msg: string): never {
  process.stderr.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(1);
}

/**
 * A draft body from `--body <text>`, or from stdin when it is `-`.
 *
 * The stdin path is the one that matters: anything generating comments produces
 * multi-line prose, and pushing that through a shell argument is where quoting
 * goes wrong. `--body -` is how a reviewing agent writes back.
 */
export async function readBody(value: string): Promise<string> {
  if (value !== '-') return value;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (!body) throw new Error('No body on stdin');
  return body;
}
