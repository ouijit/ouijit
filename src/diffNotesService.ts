/**
 * Reading and writing the notes on a worktree's diff.
 *
 * Apart from `src/diffNotes.ts`, which the renderer imports for the type and
 * the hand-over format: this half touches the database, so importing it there
 * would drag sqlite into the renderer bundle.
 */

import { randomUUID } from 'node:crypto';
import { getDiffNotes, saveDiffNote, deleteDiffNote, clearDiffNotes, type DiffNoteRow } from './db';
import type { DiffNote, SaveDiffNoteInput } from './diffNotes';

function toNote(row: DiffNoteRow): DiffNote {
  return {
    id: row.id,
    worktreePath: row.worktree_path,
    path: row.path,
    line: row.line,
    side: row.side,
    lineText: row.line_text,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listNotes(worktreePath: string): Promise<DiffNote[]> {
  return (await getDiffNotes(worktreePath)).map(toNote);
}

export async function saveNote(input: SaveDiffNoteInput): Promise<{ success: boolean }> {
  // `created_at` only lands on an insert — the repo's upsert leaves it alone —
  // so editing a note keeps the timestamp it was written with, and does not
  // move it to the end of a list that is ordered by where it points.
  await saveDiffNote({
    id: input.id ?? randomUUID(),
    worktree_path: input.worktreePath,
    path: input.path,
    line: input.line,
    side: input.side,
    line_text: input.lineText ?? null,
    body: input.body,
    created_at: new Date().toISOString(),
  });
  return { success: true };
}

export async function discardNote(id: string): Promise<{ success: boolean }> {
  await deleteDiffNote(id);
  return { success: true };
}

export async function clearNotes(worktreePath: string): Promise<{ success: boolean }> {
  await clearDiffNotes(worktreePath);
  return { success: true };
}
