/**
 * JSON output helpers for the CLI.
 * All commands output JSON to stdout. Errors go to stderr.
 */

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
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
