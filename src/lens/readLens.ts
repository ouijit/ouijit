import { getDiffLens, deleteDiffLens } from '../db';
import { parseLens, type LensGroup } from './lens';
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

  const stale = (await subject.pin()) !== row.pin;
  const groups = stale && subject.whenStale === 'drop' ? null : parseLens(row.groups);
  return { groups, lensId: row.lens_id, lensName: row.lens_name, stale };
}

/** Forget the lens written for a diff. */
export function clearLens(subject: DiffSubject): Promise<{ success: boolean }> {
  return deleteDiffLens(subject.projectPath, subject.key);
}
