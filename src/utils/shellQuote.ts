const SAFE_SHELL_WORD = /^[\w@%+=:,./-]+$/;

/** An argv as one line a POSIX shell splits back into the same words. */
export function shellJoin(argv: string[]): string {
  return argv.map((arg) => (SAFE_SHELL_WORD.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(' ');
}
