/**
 * Notes written against a worktree diff. A note never leaves the machine: it
 * ends up in the prompt of the agent working in the worktree, so the output
 * format is the interface and the formatter lives with the type.
 */

import { describeLines } from './diffAnchor';

export interface DiffNote {
  id: string;
  /** The worktree the diff is of — a task's, or the project for a plain shell. */
  worktreePath: string;
  path: string;
  /** The last line of the range, and where the note renders. */
  line: number;
  /** The first line. Equal to `line` where the note is on one. */
  startLine: number;
  /**
   * Whether the note is about code that is there (`RIGHT`) or gone (`LEFT`).
   * Decides which way the note outlives its subject — see `judgeAnchor` in
   * `snippetAnchor.ts`.
   */
  side: 'LEFT' | 'RIGHT';
  /**
   * The source the note was written about, which is what anchors it: the agent
   * edits these files, and an edit above the note moves its numbers. Written
   * once at creation — re-reading it would re-point the note at whatever
   * replaced it.
   */
  snippet: string | null;
  body: string;
  createdAt: string;
}

export interface SaveDiffNoteInput {
  /** Set when editing an existing note rather than writing a new one. */
  id?: string;
  worktreePath: string;
  path: string;
  line: number;
  startLine?: number;
  side: 'LEFT' | 'RIGHT';
  /** Ignored on an edit: a note's snippet is fixed at creation. */
  snippet?: string | null;
  body: string;
}

/**
 * The notes as one block of text to paste into an agent: blank-line-separated
 * blocks opening with `path:line`, the quoted source marked with `>`, and the
 * body unindented after it.
 *
 * No trailing newline — in a TUI that is the Enter key.
 *
 * `subject` names the comparison the notes were written on (`diffSubject` in
 * `diffSource.ts`), since a line number means something different against the
 * working tree than against a branch.
 */
export function formatNotesForAgent(notes: DiffNote[], subject: string): string {
  if (notes.length === 0) return '';

  const heading = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} on ${subject}.`;

  const blocks = notes.map((note) => {
    // A LEFT anchor's numbers are in the file as it was, and resolve against
    // nothing on disk.
    const where = `${note.path}:${describeLines(note.startLine, note.line)}${note.side === 'LEFT' ? ' (removed)' : ''}`;
    return [where, quote(note.snippet), note.body.trim()].filter(Boolean).join('\n');
  });

  return [heading, ...blocks].join('\n\n');
}

/** The snippet as quoted lines, with only the shared indent removed. */
function quote(snippet: string | null): string {
  const lines = (snippet ?? '').split('\n');
  const written = lines.filter((line) => line.trim());
  if (written.length === 0) return '';

  const shared = Math.min(...written.map((line) => line.length - line.trimStart().length));
  return lines.map((line) => `> ${line.slice(shared).trimEnd()}`).join('\n');
}
