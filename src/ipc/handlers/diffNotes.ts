import { randomUUID } from 'node:crypto';
import { typedHandle } from '../helpers';
import { getDiffNotes, saveDiffNote, deleteDiffNote, clearDiffNotes } from '../../db';
import type { DiffNote } from '../../diffNotes';
import type { DiffNoteRow } from '../../db';

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

export function registerDiffNoteHandlers(): void {
  typedHandle('diff-notes:list', async (worktreePath) => (await getDiffNotes(worktreePath)).map(toNote));

  typedHandle('diff-notes:save', async (input) => {
    // An edit keeps the timestamp it was written with, so editing a note does
    // not move it to the end of a list that is ordered by where it points.
    const existing = input.id ? (await getDiffNotes(input.worktreePath)).find((n) => n.id === input.id) : undefined;
    const row = await saveDiffNote({
      id: input.id ?? randomUUID(),
      worktree_path: input.worktreePath,
      path: input.path,
      line: input.line,
      side: input.side,
      line_text: input.lineText ?? null,
      body: input.body,
      created_at: existing?.created_at ?? new Date().toISOString(),
    });
    return toNote(row);
  });

  typedHandle('diff-notes:discard', async (id) => {
    await deleteDiffNote(id);
    return { success: true };
  });

  typedHandle('diff-notes:clear', async (worktreePath) => {
    await clearDiffNotes(worktreePath);
    return { success: true };
  });
}
