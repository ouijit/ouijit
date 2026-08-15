import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import log from 'electron-log/renderer';
import type { FileDiff } from '../../types';
import type { StoredLens } from '../../lens/readLens';
import { resolveLens, type ResolvedGroup } from '../../lens/lens';
import { useProjectStore } from '../../stores/projectStore';
import { describeError } from '../../utils/describeError';
import { useDiffSlices } from './diffSlice';

const lensLog = log.scope('lens');

/**
 * A diff a lens can be read for and written over, as the renderer sees it.
 *
 * The mirror of main's `DiffSubject`: a pull request and a worktree's own
 * changes differ in where the lens is read from and what the run is called, and
 * in nothing else. Everything around those — when to re-read, what a failed run
 * leaves behind, whether the lens comes up applied — is the session, and there
 * is one of it.
 */
export interface LensSource {
  /**
   * What a run belongs to. Null when there is no diff to read a lens for.
   *
   * Deliberately not the head: a run in flight belongs to the pull request, not
   * to the commit that was on top when it started, and it is what a reopened
   * pane matches itself against to find the run it left going.
   */
  key: string | null;
  /** Changes when the diff itself moves, so the stored lens is read again. */
  revision?: string;
  read: () => Promise<StoredLens | null>;
  write: (lensName: string) => Promise<{ success: boolean; error?: string }>;
  /**
   * Something outside this pane touched the lens.
   *
   * `apply` says whether it is the kind of change worth showing unasked: an
   * agent writing a lens is, a lens being renamed in settings is not — that
   * changes what it is called and nothing about what the reader chose to see.
   */
  subscribe?: (refresh: (apply: boolean) => void) => () => void;
}

/**
 * Runs in flight, by subject key.
 *
 * Outside React because a run outlives the pane that started it: it happens in
 * the main process, and closing a pull request to go and look at something else
 * is not a reason to stop being told about it. Keyed rather than singular so
 * two diffs can be read at once and each only claims its own.
 */
const runs = new Map<string, string>();
const listeners = new Set<() => void>();

function setRun(key: string, name: string | null): void {
  if (name) runs.set(key, name);
  else runs.delete(key);
  for (const listener of listeners) listener();
}

function subscribeToRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam — module state outlives a render, which is the point of it. */
export function _resetLensRunsForTesting(): void {
  runs.clear();
  listeners.clear();
}

export interface LensSession {
  /** The lens on file, or null when none has been written. */
  lens: StoredLens | null;
  /** Its groups bound to the diff on screen, whether or not they are showing. */
  resolved: ResolvedGroup[] | null;
  /** The same, or null when the reader has asked for the flat file list. */
  shown: ResolvedGroup[] | null;
  lensOn: boolean;
  setLensOn: (on: boolean) => void;
  /** Name of the lens being written for this diff, if one is running. */
  writing: string | null;
  run: (lensName: string) => Promise<void>;
  /** One file's diff narrowed to the hunks a group claims. */
  sliceFor: ReturnType<typeof useDiffSlices>;
}

export function useLensSession(source: LensSource, diffs: Map<string, FileDiff | null>, order: string[]): LensSession {
  const { key, revision } = source;

  // The source is rebuilt on every render; only its key and revision say
  // anything has actually changed, so the effects below watch those and reach
  // the current callbacks through here.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const [lens, setLens] = useState<StoredLens | null>(null);

  /**
   * Whether the reader has overridden the default, which is to show a lens once
   * there is one. Null rather than a boolean so an arriving lens can go back to
   * the default without having to guess what the reader last pressed.
   */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const lensOn = chosen ?? true;

  const writing = useSyncExternalStore<string | null>(subscribeToRuns, () => (key ? (runs.get(key) ?? null) : null));

  const refresh = useCallback(async (apply: boolean): Promise<void> => {
    const at = sourceRef.current.key;
    if (!at) return;

    let next: StoredLens | null = null;
    try {
      next = await sourceRef.current.read();
    } catch (error) {
      // A lens that cannot be read is a lens there isn't. Logged rather than
      // raised: the diff is unaffected, and this runs on every pane open.
      lensLog.warn('failed to read the lens', { key: at, error: describeError(error) });
    }
    // The pane may have moved on while that was in flight.
    if (sourceRef.current.key !== at) return;

    setLens(next);
    // Someone went to the trouble of having an agent describe this change;
    // showing the flat list anyway would hide that behind a control they would
    // have to know to press.
    if (apply && next?.groups) setChosen(null);
  }, []);

  useEffect(() => {
    setLens(null);
    setChosen(null);
    void refresh(true);
  }, [key, revision, refresh]);

  useEffect(() => {
    if (!key) return;
    return sourceRef.current.subscribe?.((apply) => void refresh(apply));
  }, [key, refresh]);

  const run = useCallback(
    async (lensName: string): Promise<void> => {
      const at = sourceRef.current.key;
      if (!at || runs.has(at)) return;

      setRun(at, lensName);
      try {
        const result = await sourceRef.current.write(lensName);
        if (!result.success) {
          useProjectStore.getState().addToast(result.error ?? `“${lensName}” could not read this change`, 'error');
          return;
        }
        // Read back here rather than waited for: this call knows it finished,
        // so being told by a push would be indirection standing in for
        // something already known. The push exists for the other writer — an
        // agent using the CLI, in another process, that nothing here can see.
        if (sourceRef.current.key === at) await refresh(true);
      } catch (error) {
        useProjectStore.getState().addToast(`Could not write the lens: ${describeError(error)}`, 'error');
      } finally {
        // Whatever happened, it is no longer happening. Clearing only on
        // success is how a failed run leaves a spinner turning for ever.
        setRun(at, null);
      }
    },
    [refresh],
  );

  // Resolution needs the parsed diffs, so it waits for them: until they land
  // the lens has nothing to point at.
  const resolved = useMemo(
    () => (lens?.groups && order.length > 0 ? resolveLens(lens.groups, diffs, order) : null),
    [lens, diffs, order],
  );

  // A different diff, or a different grouping of it, makes every cached slice
  // meaningless. The key stands in where there is no lens, so moving between
  // two ungrouped diffs still clears it.
  const sliceFor = useDiffSlices(lens ?? key);

  return {
    lens,
    resolved,
    shown: lensOn ? resolved : null,
    lensOn,
    setLensOn: setChosen,
    writing,
    run,
    sliceFor,
  };
}
