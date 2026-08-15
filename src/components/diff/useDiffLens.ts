import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileDiff } from '../../types';
import type { DiffLensResult, DiffLensTarget } from '../../diffLens';
import { resolveLens } from '../../lens/lens';
import { useDiffSlices } from './diffSlice';
import { useProjectLenses } from './useProjectLenses';
import { useProjectStore } from '../../stores/projectStore';
import { describeError } from '../../utils/describeError';

/** The lens over a worktree diff: what is stored, and what it resolves to. */
export function useDiffLens(target: DiffLensTarget | null, diffs: Map<string, FileDiff | null>, order: string[]) {
  const [lens, setLens] = useState<DiffLensResult | null>(null);
  const { lenses } = useProjectLenses(target?.projectPath ?? '');
  const [lensOn, setLensOn] = useState(true);
  const [writing, setWriting] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // A string rather than the target object, which is rebuilt on every render
  // and would make the effects below reload forever.
  const key = target ? `${target.worktreePath}\0${target.mode}\0${target.branch ?? ''}` : null;

  const reload = useCallback(async () => {
    if (!target) return;
    try {
      setLens(await window.api.diffLens.get(target));
    } catch {
      setLens(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable proxy for target
  }, [key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (lensName: string) => {
      if (!target || writing) return;
      setWriting(lensName);
      try {
        const result = await window.api.diffLens.run(target, lensName);
        if (!result.success) {
          useProjectStore.getState().addToast(result.error ?? 'Could not write the lens', 'error');
          return;
        }
        setLensOn(true);
        await reload();
      } catch (error) {
        useProjectStore.getState().addToast(`Could not write the lens: ${describeError(error)}`, 'error');
      } finally {
        setWriting(null);
      }
    },
    [target, writing, reload],
  );

  // Recomputed whenever either side moves, which for a working tree is often.
  // Safe because `resolveLens` gives unclaimed hunks a trailing group of their
  // own, so a drifted lens cannot hide a change.
  const resolved = useMemo(() => {
    if (!lens || !lensOn || order.length === 0) return null;
    return resolveLens(lens.groups, diffs, order);
  }, [lens, lensOn, diffs, order]);

  // A different diff, or a different grouping of it, makes every cached slice
  // meaningless.
  const sliceFor = useDiffSlices(lens);

  return {
    lens,
    lenses,
    resolved,
    lensOn,
    setLensOn,
    writing,
    collapsed,
    setCollapsed,
    run,
    sliceFor,
  };
}
