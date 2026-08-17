/**
 * A note's lifetime through the store, against a real working tree.
 *
 * Which way each verdict goes is settled in `snippetAnchor.test.ts`; this is
 * only what that costs on the way through — that a moved note is renumbered on
 * disk rather than worked out again on every read, that a spent one is really
 * deleted, and that neither happens to writing still in progress.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { _resetCacheForTesting } from '../../db';
import { liveNotes, saveNote } from '../../diffNotesService';

let tree: string;

const SOURCE = ['import { thing } from "./thing";', '', 'export function go() {', '  return thing();', '}', ''];

async function write(lines: string[]): Promise<void> {
  await fs.writeFile(path.join(tree, 'src/a.ts'), lines.join('\n'));
}

/** A note on `go()`'s body — lines 3 to 4 as the file first reads. */
async function noteOnGo(): Promise<void> {
  await saveNote({
    worktreePath: tree,
    path: 'src/a.ts',
    line: 4,
    startLine: 3,
    side: 'RIGHT',
    snippet: 'export function go() {\n  return thing();',
    body: 'this can throw',
  });
}

beforeEach(async () => {
  _resetCacheForTesting();
  tree = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-diff-notes-'));
  await fs.mkdir(path.join(tree, 'src'), { recursive: true });
  await write(SOURCE);
});

describe('a note lives as long as the code it is about', () => {
  test('is renumbered where it now sits, and stays renumbered', async () => {
    await noteOnGo();
    await write(['// a note to self', '', ...SOURCE]);

    const [note] = await liveNotes(tree);
    expect([note.startLine, note.line]).toEqual([5, 6]);

    // Written back rather than worked out again: the next sweep searches from
    // where the note now is, which is what keeps the nearest match the right one.
    const [again] = await liveNotes(tree);
    expect([again.startLine, again.line]).toEqual([5, 6]);
  });

  test('is gone once the agent has rewritten what it was about', async () => {
    await noteOnGo();
    await write(SOURCE.map((l) => (l === '  return thing();' ? '  return thing() ?? fallback();' : l)));

    expect(await liveNotes(tree)).toEqual([]);
  });

  /**
   * Deleting the note being written into would take the writing with it, and
   * there is no undo for that.
   */
  test('is held back while it is open for editing, however far its code has gone', async () => {
    await noteOnGo();
    const [note] = await liveNotes(tree);
    await write(['nothing it was written about is here any more']);

    expect(await liveNotes(tree, [note.id])).toHaveLength(1);
    expect(await liveNotes(tree)).toEqual([]);
  });

  test('editing the body leaves the note about the code it was written about', async () => {
    await noteOnGo();
    const [note] = await liveNotes(tree);

    await saveNote({
      id: note.id,
      worktreePath: tree,
      path: 'src/a.ts',
      line: note.line,
      side: 'RIGHT',
      body: 'this can throw, and the caller does not catch it',
    });

    const [edited] = await liveNotes(tree);
    expect(edited.body).toBe('this can throw, and the caller does not catch it');
    // Not re-read from the file as it now stands: a note that re-recorded
    // itself on every edit could never go out of date, and so would never end.
    expect(edited.snippet).toBe('export function go() {\n  return thing();');
    expect(edited.createdAt).toBe(note.createdAt);
  });
});
