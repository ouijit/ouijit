import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import log from 'electron-log/renderer';
import type { FileDiff } from '../../types';
import type { StoredLens } from '../../lens/readLens';
import type { LensSummary } from '../../lens/config';
import { resolveLens, type ResolvedGroup } from '../../lens/lens';
import { useProjectStore } from '../../stores/projectStore';
import { describeError } from '../../utils/describeError';
import { useDiffSlices } from './diffSlice';

const lensLog = log.scope('lens');

/**
 * A diff a lens can be read for and written over, as the renderer sees it. The
 * mirror of main's `DiffSubject`: a pull request and a worktree's own changes
 * differ here and in nothing else.
 */
export interface LensSource {
  /**
   * What a run belongs to. Not the head commit: a run in flight belongs to the
   * pull request rather than to whatever was on top when it started, and a
   * reopened pane matches against this to find the run it left going.
   */
  key: string | null;
  /** Changes when the diff itself moves, so the stored lens is read again. */
  revision?: string;
  read: () => Promise<StoredLens | null>;
  write: (lensId: string) => Promise<{ success: boolean; error?: string }>;
  /**
   * Something outside this pane wrote or cleared the lens. `apply` says whether
   * it is worth showing unasked — a grouping that has landed is, one that has
   * only been cleared is not.
   */
  subscribe?: (refresh: (apply: boolean) => void) => () => void;
}

/**
 * A run in flight. The name is carried rather than looked up, since the lens may
 * be deleted while its run is still going.
 */
export interface LensRun {
  id: string;
  name: string;
}

/**
 * Outside React because a run happens in the main process and outlives the pane
 * that started it. By key so two diffs can be read at once.
 */
const runs = new Map<string, LensRun>();
/**
 * Keys whose spinner was adopted from main rather than started here. A run this
 * pane started clears itself when the call returns; one it picked up already
 * going has only the next read to end it. Ending unadopted runs there too would
 * kill a live spinner in the gap between starting a run and main recording it.
 */
const adopted = new Set<string>();
const listeners = new Set<() => void>();

function setRun(key: string, run: LensRun | null): void {
  if (run) runs.set(key, run);
  else runs.delete(key);
  for (const listener of listeners) listener();
}

function subscribeToRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function syncRun(key: string, running: StoredLens['running']): void {
  if (running?.live) {
    if (runs.has(key)) return;
    adopted.add(key);
    setRun(key, { id: running.lensId, name: running.lensName });
  } else if (adopted.delete(key)) {
    setRun(key, null);
  }
}

export function _resetLensRunsForTesting(): void {
  runs.clear();
  adopted.clear();
  listeners.clear();
}

export interface LensSession {
  lens: StoredLens | null;
  /** Its groups bound to the diff on screen, whether or not they are showing. */
  resolved: ResolvedGroup[] | null;
  /** The same, or null when the reader has asked for the flat file list. */
  shown: ResolvedGroup[] | null;
  lensOn: boolean;
  setLensOn: (on: boolean) => void;
  writing: LensRun | null;
  /**
   * Bumped when the document rearranges itself unasked. Not on every read: a
   * poll that finds the same lens, and a pane opened on a diff that already had
   * one, changed nothing under the reader.
   */
  landed: number;
  run: (pick: LensSummary) => Promise<void>;
  /** One file's diff narrowed to the hunks a group claims. */
  sliceFor: ReturnType<typeof useDiffSlices>;
}

export function useLensSession(source: LensSource, diffs: Map<string, FileDiff | null>, order: string[]): LensSession {
  const { key, revision } = source;

  // The source is rebuilt on every render, so the effects below depend on its
  // key and revision and reach the current callbacks through here.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const [lens, setLens] = useState<StoredLens | null>(null);

  /**
   * Whether the reader has overridden the default, which is to show a lens once
   * there is one. Null rather than a boolean so an arriving lens can return to
   * the default without guessing what the reader last pressed.
   */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const lensOn = chosen ?? true;

  const readFor = useRef<string | null>(null);

  const [landed, setLanded] = useState(0);
  /** The lens on screen, and whether a read for this diff has come back at all. */
  const held = useRef<{ lens: StoredLens | null; read: boolean }>({ lens: null, read: false });

  const writing = useSyncExternalStore<LensRun | null>(subscribeToRuns, () => (key ? (runs.get(key) ?? null) : null));

  const refresh = useCallback(async (apply: boolean): Promise<void> => {
    const at = sourceRef.current.key;
    if (!at) return;

    let next: StoredLens | null = null;
    try {
      next = await sourceRef.current.read();
    } catch (error) {
      // A lens that cannot be read is a lens there isn't; the diff is fine.
      lensLog.warn('failed to read the lens', { key: at, error: describeError(error) });
    }
    if (sourceRef.current.key !== at) return;

    // Their own run finishing, or a grouping written elsewhere arriving — as
    // against the first read for a diff, which is how they found it.
    const arriving = Boolean(next?.groups) && held.current.read && (runs.has(at) || !held.current.lens?.groups);
    held.current = { lens: next, read: true };

    setLens(next);
    if (arriving) setLanded((n) => n + 1);
    syncRun(at, next?.running ?? null);
    if (apply && next?.groups) setChosen(null);
  }, []);

  useEffect(() => {
    // A different diff: nothing held here describes it, and a lens that turns
    // up for it comes up applied. A diff that has only moved — the working tree
    // on every save, a pull request on a push — is the same diff read again, so
    // it keeps both the grouping on screen and the reader's choice about it.
    const elsewhere = readFor.current !== key;
    readFor.current = key;
    if (elsewhere) {
      setLens(null);
      setChosen(null);
      held.current = { lens: null, read: false };
    }
    void refresh(elsewhere);
  }, [key, revision, refresh]);

  useEffect(() => {
    if (!key) return;
    return sourceRef.current.subscribe?.((apply) => void refresh(apply));
  }, [key, refresh]);

  const run = useCallback(
    async (pick: LensSummary): Promise<void> => {
      const at = sourceRef.current.key;
      if (!at || runs.has(at)) return;

      setRun(at, { id: pick.id, name: pick.name });
      try {
        const result = await sourceRef.current.write(pick.id);
        if (!result.success) {
          useProjectStore.getState().addToast(result.error ?? `“${pick.name}” could not read this change`, 'error');
          return;
        }
        // Read back here rather than waited for on the push, which exists for
        // the other writer: an agent using the CLI, in a process this cannot see.
        if (sourceRef.current.key === at) await refresh(true);
      } catch (error) {
        useProjectStore.getState().addToast(`Could not write the lens: ${describeError(error)}`, 'error');
      } finally {
        setRun(at, null);
      }
    },
    [refresh],
  );

  const resolved = useMemo(
    () => (lens?.groups && order.length > 0 ? resolveLens(lens.groups, diffs, order) : null),
    [lens, diffs, order],
  );

  // A different diff, or a different grouping of it, makes every cached slice
  // meaningless. The key stands in where there is no lens, so moving between
  // two ungrouped diffs still clears them.
  const sliceFor = useDiffSlices(lens ?? key);

  return {
    lens,
    resolved,
    shown: lensOn ? resolved : null,
    lensOn,
    setLensOn: setChosen,
    writing,
    landed,
    run,
    sliceFor,
  };
}
