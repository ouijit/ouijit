/**
 * Notes written against a worktree diff, and the text they are handed over as.
 *
 * Unlike a pull request comment, a note never leaves the machine — it ends up
 * in the prompt of the agent working in the worktree. The output format is the
 * whole interface, so the formatter lives with the type rather than in the
 * component that copies it.
 */

import { describeLines } from './diffAnchor';

export interface DiffNote {
  id: string;
  /** The worktree the diff is of — a task's, or the project itself for a plain shell. */
  worktreePath: string;
  path: string;
  /** The last line of the range, and where the note renders. */
  line: number;
  /** The first line. Equal to `line` where the note is on one. */
  startLine: number;
  /**
   * Whether the note is about code that is there (`RIGHT`) or about code that
   * has gone (`LEFT`). It decides which way the note outlives its subject —
   * see `judgeAnchor` in `snippetAnchor.ts`.
   */
  side: 'LEFT' | 'RIGHT';
  /**
   * The source the note was written about, as it read at the time.
   *
   * This, rather than the line number, is what the note is anchored by: the
   * agent edits these same files, and an edit above the note moves its numbers
   * without touching what it is about. Written once, at creation — re-reading
   * it later would re-point the note at whatever has replaced it.
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
  /** Ignored on an edit: a note's snippet is what it was written about. */
  snippet?: string | null;
  body: string;
}

/**
 * The notes as one block of text to paste into an agent.
 *
 * Blank-line-separated blocks, each opening with `path:line` in the form every
 * compiler and linter already prints. The quoted source follows, marked with
 * `>`; everything after it is the note body, unindented so a multi-line note
 * survives the round trip.
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
    // A LEFT anchor is about code that was taken out, so its numbers are in the
    // file as it was and resolve against nothing on disk.
    const where = `${note.path}:${describeLines(note.startLine, note.line)}${note.side === 'LEFT' ? ' (removed)' : ''}`;
    return [where, quote(note.snippet), note.body.trim()].filter(Boolean).join('\n');
  });

  return [heading, ...blocks].join('\n\n');
}

/**
 * The snippet as quoted lines, shifted left as far as they all go together.
 *
 * Only the shared indent comes off: inside a block, the relative indentation is
 * most of what says where one line sits in relation to the next.
 */
function quote(snippet: string | null): string {
  const lines = (snippet ?? '').split('\n');
  const written = lines.filter((line) => line.trim());
  if (written.length === 0) return '';

  const shared = Math.min(...written.map((line) => line.length - line.trimStart().length));
  return lines.map((line) => `> ${line.slice(shared).trimEnd()}`).join('\n');
}
