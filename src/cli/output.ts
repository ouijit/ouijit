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
