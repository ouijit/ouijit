import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiffNote, SaveDiffNoteInput } from '../../diffNotes';
import { anchorKey } from './diffAnchor';
import { useProjectStore } from '../../stores/projectStore';
import { describeError } from '../../utils/describeError';

/** The line an unsaved note is being written against. */
export interface ComposingAt {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
}

/**
 * The notes on one worktree's diff.
 *
 * Stored in the database rather than in component state, so a half-written
 * review survives the panel being closed or the app restarting.
 */
export function useDiffNotes(worktreePath: string) {
  const [notes, setNotes] = useState<DiffNote[]>([]);
  const [composingAt, setComposingAt] = useState<ComposingAt | null>(null);
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

  const save = useCallback(
    async (input: Omit<SaveDiffNoteInput, 'worktreePath'>) => {
      try {
        await window.api.diffNotes.save({ ...input, worktreePath });
      } catch (error) {
        // Returning early leaves the box open, so a failed save doesn't
        // discard what was typed.
        useProjectStore.getState().addToast(`Could not save the note: ${describeError(error)}`, 'error');
        return;
      }
      setComposingAt(null);
      setEditingId(null);
      await reload();
    },
    [worktreePath, reload],
  );

  const discard = useCallback(
    async (id: string) => {
      try {
        await window.api.diffNotes.discard(id);
      } catch (error) {
        useProjectStore.getState().addToast(`Could not discard the note: ${describeError(error)}`, 'error');
        return;
      }
      setEditingId(null);
      await reload();
    },
    [reload],
  );

  const clear = useCallback(async () => {
    try {
      await window.api.diffNotes.clear(worktreePath);
    } catch (error) {
      useProjectStore.getState().addToast(`Could not clear the notes: ${describeError(error)}`, 'error');
      return;
    }
    await reload();
  }, [worktreePath, reload]);

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
