/**
 * Notes written against a worktree diff, and the text they are handed over as.
 *
 * Unlike a pull request comment, a note never leaves the machine — it ends up
 * in the prompt of the agent working in the worktree. The output format is the
 * whole interface, so the formatter lives with the type rather than in the
 * component that copies it.
 */

export interface DiffNote {
  id: string;
  /** The worktree the diff is of — a task's, or the project itself for a plain shell. */
  worktreePath: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  /**
   * The source line as it read when the note was written.
   *
   * Stored rather than looked up on demand: the agent edits these same files,
   * so the line may have moved or gone by the time the note is handed over,
   * and the quote is what makes a stale line number recoverable.
   */
  lineText: string | null;
  body: string;
  createdAt: string;
}

export interface SaveDiffNoteInput {
  /** Set when editing an existing note rather than writing a new one. */
  id?: string;
  worktreePath: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  lineText?: string | null;
  body: string;
}

/**
 * The notes as one block of text to paste into an agent.
 *
 * Blank-line-separated blocks, each opening with `path:line` in the form every
 * compiler and linter already prints. The quoted source line follows, marked
 * with `>`; everything after it is the note body, unindented so a multi-line
 * note survives the round trip.
 *
 * No trailing newline: this is pasted into a prompt, and a trailing newline in
 * a TUI is the Enter key.
 *
 * `subject` names the comparison the notes were written on — `diffSubject` in
 * `diffSource.ts` — since a line number means something different against the
 * working tree than against a branch.
 */
export function formatNotesForAgent(notes: DiffNote[], subject: string): string {
  if (notes.length === 0) return '';

  const heading = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} on ${subject}.`;

  const blocks = notes.map((note) => {
    // A LEFT anchor numbers the line in the file as it was, so without the
    // marker the number does not resolve against the file on disk.
    const where = `${note.path}:${note.line}${note.side === 'LEFT' ? ' (removed line)' : ''}`;
    const quoted = note.lineText?.trim() ? `\n> ${note.lineText.trim()}` : '';
    return `${where}${quoted}\n${note.body.trim()}`;
  });

  return [heading, ...blocks].join('\n\n');
}
