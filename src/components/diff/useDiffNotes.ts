import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffNote, SaveDiffNoteInput } from '../../diffNotes';
import { anchorKey, type DiffAnchor } from '../../diffAnchor';
import { useProjectStore } from '../../stores/projectStore';
import { describeError } from '../../utils/describeError';

/**
 * Notes on one worktree's diff, kept in the database so a half-written review
 * survives the panel closing or the app restarting.
 *
 * Re-read whenever `revision` changes, which is also when notes whose code has
 * gone are swept. The note being edited is exempted from that sweep.
 */
export function useDiffNotes(worktreePath: string, revision: string) {
  const [notes, setNotes] = useState<DiffNote[]>([]);
  const [composingAt, setComposingAt] = useState<DiffAnchor | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Through a ref: reloads follow the tree moving, and naming `editingId` as a
  // dependency would also reload whenever a box is opened.
  const editing = useRef<string | null>(null);
  editing.current = editingId;

  const reload = useCallback(async () => {
    try {
      setNotes(await window.api.diffNotes.list(worktreePath, editing.current ? [editing.current] : []));
    } catch {
      // The diff is still readable without them.
      setNotes([]);
    }
  }, [worktreePath]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);

  /**
   * Writes, then re-reads. Returning before `settle` on failure is what leaves
   * an open box open, so a save that did not land keeps what was typed.
   */
  const mutate = useCallback(
    async (verb: string, write: () => Promise<unknown>, settle?: () => void) => {
      try {
        await write();
      } catch (error) {
        useProjectStore.getState().addToast(`Could not ${verb}: ${describeError(error)}`, 'error');
        return;
      }
      settle?.();
      await reload();
    },
    [reload],
  );

  const save = useCallback(
    (input: Omit<SaveDiffNoteInput, 'worktreePath'>) =>
      mutate(
        'save the note',
        () => window.api.diffNotes.save({ ...input, worktreePath }),
        () => {
          setComposingAt(null);
          setEditingId(null);
        },
      ),
    [worktreePath, mutate],
  );

  const discard = useCallback(
    (id: string) =>
      mutate(
        'discard the note',
        () => window.api.diffNotes.discard(id),
        () => setEditingId(null),
      ),
    [mutate],
  );

  const clear = useCallback(
    () => mutate('clear the notes', () => window.api.diffNotes.clear(worktreePath)),
    [worktreePath, mutate],
  );

  // One lookup per rendered line rather than a scan of every note on the diff.
  const byAnchor = useMemo(() => Map.groupBy(notes, (note) => anchorKey(note.path, note.line, note.side)), [notes]);

  // Held stable so the panel's `renderBelowLine` can memoize on it; otherwise
  // every file section below re-renders on every render.
  return useMemo(
    () => ({ notes, byAnchor, composingAt, setComposingAt, editingId, setEditingId, save, discard, clear }),
    [notes, byAnchor, composingAt, editingId, save, discard, clear],
  );
}
