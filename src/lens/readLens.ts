import { getDiffLens, deleteDiffLens } from '../db';
import { listLenses } from './config';
import { parseLens, type LensGroup } from './lens';
import { liveRun } from './runRegistry';
import type { DiffSubject } from './subject';

/**
 * The lens stored for one diff, as everything that reads one sees it. Whether a
 * drifted lens is still worth drawing is the subject's `whenStale` to declare.
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
   * A display fallback, not the identity: prefer the current name by id. This is
   * what is left to call the grouping once that lens has been deleted.
   */
  lensName: string | null;
  /** Written against a different diff than the one on screen. */
  stale: boolean;
  /**
   * Hunks the agent was given a line span for rather than the code, because the
   * change did not fit one prompt.
   */
  omitted: number;
  /**
   * A run recorded against this diff, if the lens it names still exists. `live`
   * says an agent is writing it now, which only the process that started one can
   * answer; not live means that process ended first and the run can be offered
   * again.
   */
  running: { lensId: string; lensName: string; since: string | null; live: boolean } | null;
}

/**
 * Null for a lens since deleted: nothing to run again and nothing to call it.
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
 * Null only when nothing has been written. A stale lens comes back named even
 * where its groups are dropped, or the picker has no way to offer writing it
 * again.
 */
export async function readLens(subject: DiffSubject): Promise<StoredLens | null> {
  const row = await getDiffLens(subject.projectPath, subject.key);
  if (!row) return null;

  const running = await runningOn(subject, row);
  // A run that has not answered yet: nothing written, so no pin to compare.
  if (row.groups === null || row.pin === null) {
    return { groups: null, lensId: null, lensName: null, stale: false, omitted: 0, running };
  }

  const stale = (await subject.pin()) !== row.pin;
  const groups = stale && subject.whenStale === 'drop' ? null : parseLens(row.groups);
  return { groups, lensId: row.lens_id, lensName: row.lens_name, stale, omitted: row.omitted, running };
}

export function clearLens(subject: DiffSubject): Promise<{ success: boolean }> {
  return deleteDiffLens(subject.projectPath, subject.key);
}
