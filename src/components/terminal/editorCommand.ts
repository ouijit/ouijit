/**
 * Build the shell command that opens a worktree in the configured editor.
 *
 * The worktree path is single-quoted so spaces and other shell metacharacters
 * survive intact. The runner's working directory is already the worktree, but
 * passing the path explicitly matches editors invoked with a directory argument
 * (e.g. `code <dir>`, `hx <dir>`). Pure over its inputs so it's easy to
 * unit-test.
 */
export function buildEditorCommand(editorCommand: string, worktreePath: string): string {
  const quotedPath = `'${worktreePath.replace(/'/g, "'\\''")}'`;
  return `${editorCommand} ${quotedPath}`;
}
