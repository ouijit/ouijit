import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiffNote, SaveDiffNoteInput } from '../../diffNotes';
import { anchorKey, type DiffAnchor } from './diffAnchor';
import { useProjectStore } from '../../stores/projectStore';
import { describeError } from '../../utils/describeError';

/**
 * The notes on one worktree's diff.
 *
 * Stored in the database rather than in component state, so a half-written
 * review survives the panel being closed or the app restarting.
 */
export function useDiffNotes(worktreePath: string) {
  const [notes, setNotes] = useState<DiffNote[]>([]);
  const [composingAt, setComposingAt] = useState<DiffAnchor | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setNotes(await window.api.diffNotes.list(worktreePath));
    } catch {
      // The diff is still readable without them.
      setNotes([]);
    }
  }, [worktreePath]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
      mutate('save the note', () => window.api.diffNotes.save({ ...input, worktreePath }), () => {
        setComposingAt(null);
        setEditingId(null);
      }),
    [worktreePath, mutate],
  );

  const discard = useCallback(
    (id: string) => mutate('discard the note', () => window.api.diffNotes.discard(id), () => setEditingId(null)),
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
    [notes, composingAt, editingId, save, discard, clear],
  );
}
