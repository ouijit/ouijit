/**
 * Reading and writing the notes on a worktree's diff.
 *
 * Apart from `src/diffNotes.ts`, which the renderer imports for the type and
 * the hand-over format: this half touches the database, so importing it there
 * would drag sqlite into the renderer bundle.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getDiffNotes,
  saveDiffNote,
  deleteDiffNote,
  deleteDiffNotes,
  moveDiffNote,
  clearDiffNotes,
  type DiffNoteRow,
} from './db';
import type { DiffNote, SaveDiffNoteInput } from './diffNotes';
import { judgeAnchor } from './snippetAnchor';

function toNote(row: DiffNoteRow): DiffNote {
  return {
    id: row.id,
    worktreePath: row.worktree_path,
    path: row.path,
    line: row.line,
    startLine: row.start_line ?? row.line,
    side: row.side,
    snippet: row.snippet,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * The notes still standing, after following each one to where its code went.
 *
 * The sweep runs here rather than on a timer of its own, so what a caller is
 * handed is never a note whose subject has already gone. `keep` holds back the
 * note being edited: deleting it out from under an open box would take what was
 * being typed with it.
 */
export async function liveNotes(worktreePath: string, keep: readonly string[] = []): Promise<DiffNote[]> {
  const rows = await getDiffNotes(worktreePath);
  if (rows.length === 0) return [];

  const held = new Set(keep);
  const files = new Map<string, string[] | null>();
  const dropped: string[] = [];

  for (const row of rows) {
    if (held.has(row.id)) continue;

    if (!files.has(row.path)) files.set(row.path, await readLines(worktreePath, row.path));

    const verdict = judgeAnchor(
      { side: row.side, startLine: row.start_line ?? row.line, line: row.line, snippet: row.snippet },
      files.get(row.path)!,
    );

    if (verdict.kind === 'drop') dropped.push(row.id);
    if (verdict.kind === 'move') {
      row.start_line = verdict.startLine;
      row.line = verdict.line;
      await moveDiffNote(row.id, verdict.startLine, verdict.line);
    }
  }

  await deleteDiffNotes(dropped);
  const gone = new Set(dropped);
  return rows.filter((row) => !gone.has(row.id)).map(toNote);
}

async function readLines(worktreePath: string, filePath: string): Promise<string[] | null> {
  try {
    return (await readFile(path.join(worktreePath, filePath), 'utf8')).split('\n');
  } catch {
    return null;
  }
}

export async function saveNote(input: SaveDiffNoteInput): Promise<{ success: boolean }> {
  // `snippet` and `created_at` land on the insert alone — the repo's upsert
  // rewrites the body and nothing else. Editing a note therefore keeps both the
  // time it was written and the code it was written about, and does not become
  // a note about whatever has since replaced it.
  await saveDiffNote({
    id: input.id ?? randomUUID(),
    worktree_path: input.worktreePath,
    path: input.path,
    line: input.line,
    start_line: input.startLine ?? input.line,
    side: input.side,
    snippet: input.snippet ?? null,
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
