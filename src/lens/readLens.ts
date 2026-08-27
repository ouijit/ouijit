import { getDiffLens, deleteDiffLens } from '../db';
import { listLenses } from './config';
import { parseLens, type LensGroup } from './lens';
import { liveRun } from './runRegistry';
import type { DiffSubject } from './subject';

/**
 * The lens stored for one diff, as everything that reads one sees it.
 *
 * One shape for both diffs. What they disagree about — whether a lens that has
 * drifted is still worth drawing — is a property of the diff, declared by the
 * subject as `whenStale`, rather than a reason for two result types that the
 * callers then have to reconcile.
 */
export interface StoredLens {
  /**
   * The parts of the change, or null when there are none to draw: nothing
   * readable was stored, or it has drifted and this subject drops those.
   */
  groups: LensGroup[] | null;
  /** Which lens wrote it. Null when an agent posted groups directly. */
  lensId: string | null;
  /**
   * What that lens was called when it ran.
   *
   * A display fallback, not the identity: whoever is showing this has the
   * project's lenses and should prefer the current name by id. This is what is
   * left to call the grouping once that lens has been deleted.
   */
  lensName: string | null;
  /** Written against a different diff than the one on screen. */
  stale: boolean;
  /**
   * Hunks the agent was given a line span for rather than the code, because
   * the change did not fit one prompt. A grouping that reads oddly over a huge
   * diff is explained by this rather than by the lens being wrong.
   */
  omitted: number;
  /**
   * A run recorded against this diff, if the lens it names still exists.
   *
   * `live` says an agent is writing it now. Not live means the process that
   * started it ended first — a quit, a crash, a reload — and the reader is owed
   * the offer to ask again rather than a run that silently never happened.
   */
  running: { lensId: string; lensName: string; since: string | null; live: boolean } | null;
}

/**
 * The run marked on the row, named from the project's lenses.
 *
 * Null for a lens since deleted: there is nothing to run again and nothing to
 * call it, so there is nothing worth saying.
 */
async function runningOn(subject: DiffSubject, row: { running_lens_id: string | null; running_since: string | null }) {
  if (!row.running_lens_id) return null;
  const lens = (await listLenses(subject.projectPath)).find((l) => l.id === row.running_lens_id);
  if (!lens) return null;
  return {
    lensId: lens.id,
    lensName: lens.name,
    since: row.running_since,
    live: liveRun(subject.projectPath, subject.key) === lens.id,
  };
}

/**
 * The lens on file for a diff, and whether it still describes it.
 *
 * Null only when nothing has been written. A stale lens comes back named even
 * where its groups are dropped: the picker cannot offer to write it again
 * without knowing which lens wrote it, and a reader who is not told loses an
 * agent run without ever hearing that one happened.
 */
export async function readLens(subject: DiffSubject): Promise<StoredLens | null> {
  const row = await getDiffLens(subject.projectPath, subject.key);
  if (!row) return null;

  const running = await runningOn(subject, row);
  // A run that has not answered yet. Nothing has been written for this diff, so
  // there is no pin to take and nothing to compare it against.
  if (row.groups === null || row.pin === null) {
    return { groups: null, lensId: null, lensName: null, stale: false, omitted: 0, running };
  }

  const stale = (await subject.pin()) !== row.pin;
  const groups = stale && subject.whenStale === 'drop' ? null : parseLens(row.groups);
  return { groups, lensId: row.lens_id, lensName: row.lens_name, stale, omitted: row.omitted, running };
}

/** Forget the lens written for a diff. */
export function clearLens(subject: DiffSubject): Promise<{ success: boolean }> {
  return deleteDiffLens(subject.projectPath, subject.key);
}
