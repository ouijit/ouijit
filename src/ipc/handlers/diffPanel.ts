import { randomUUID } from 'node:crypto';
import { typedHandle } from '../helpers';
import { getDiffNotes, saveDiffNote, deleteDiffNote, clearDiffNotes } from '../../db';
import { readDiffLens, writeDiffLens } from '../../diffLens';
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

export function registerDiffPanelHandlers(): void {
  typedHandle('diff-notes:list', async (worktreePath) => (await getDiffNotes(worktreePath)).map(toNote));

  typedHandle('diff-notes:save', async (input) => {
    // `created_at` only lands on an insert — the repo's upsert leaves it alone —
    // so editing a note keeps the timestamp it was written with, and does not
    // move it to the end of a list that is ordered by where it points.
    const row = await saveDiffNote({
      id: input.id ?? randomUUID(),
      worktree_path: input.worktreePath,
      path: input.path,
      line: input.line,
      side: input.side,
      line_text: input.lineText ?? null,
      body: input.body,
      created_at: new Date().toISOString(),
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

  typedHandle('diff-lens:get', (target) => readDiffLens(target));
  typedHandle('diff-lens:run', (target, lensName) => writeDiffLens(target, lensName));
}
