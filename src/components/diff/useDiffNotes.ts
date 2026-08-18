import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffNote, SaveDiffNoteInput } from '../../diffNotes';
import { anchorKey, type DiffAnchor } from '../../diffAnchor';
import { useProjectStore } from '../../stores/projectStore';
import { describeError } from '../../utils/describeError';

/**
 * The notes on one worktree's diff.
 *
 * Stored in the database rather than in component state, so a half-written
 * review survives the panel being closed or the app restarting.
 *
 * Re-read whenever `revision` changes — the fingerprint of the comparison on
 * screen, so every poll that finds the tree moved is also when the notes are
 * swept for ones whose code has gone. The note open for editing is named to
 * that sweep so an open box cannot be deleted out from under what is being
 * typed into it.
 */
export function useDiffNotes(worktreePath: string, revision: string) {
  const [notes, setNotes] = useState<DiffNote[]>([]);
  const [composingAt, setComposingAt] = useState<DiffAnchor | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Through a ref: a reload is triggered by the tree moving, never by which
  // note happens to be open, and naming it as a dependency would do both.
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
   * A write, then a re-read of the list it changed.
   *
   * Returning early on failure is what leaves an open box open, so a save that
   * did not land does not discard what was typed.
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

  // Held stable so the panel's `renderBelowLine` can be memoized on it — a new
  // object every render would be a new callback every render, and the memoized
  // file sections below it would never bail out.
  return useMemo(
    () => ({ notes, byAnchor, composingAt, setComposingAt, editingId, setEditingId, save, discard, clear }),
    [notes, byAnchor, composingAt, editingId, save, discard, clear],
  );
}
