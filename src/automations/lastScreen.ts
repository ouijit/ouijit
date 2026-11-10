const KEPT_LINES = 80;

/**
 * Raw PTY output as the plain text it last showed, near enough: escape
 * sequences dropped, carriage-return overwrites applied, the last lines kept.
 */
export function lastScreen(raw: string): string {
  const text = raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const lines = text.split('\n').map((line) => {
    const parts = line.split('\r').filter((p) => p !== '');
    return (parts[parts.length - 1] ?? '').trimEnd();
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-KEPT_LINES).join('\n');
}
