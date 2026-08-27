/**
 * Lens runs happening in this process.
 *
 * A row in `diff_lenses` marked running says an agent was started for that
 * diff. Whether it is still going is only knowable here, and this does not
 * survive a quit or a crash — which is exactly how an interrupted run is told
 * from a live one on the next launch.
 *
 * Main-process state. The renderer learns which runs are live by reading a
 * lens, not by holding its own list, so a reload stops losing the spinner.
 */

interface LiveRun {
  lensId: string;
  /** Aborted on quit, so the agent is not left orphaned behind the app. */
  abort: AbortController;
}

const live = new Map<string, LiveRun>();

function keyFor(projectPath: string, subjectKey: string): string {
  return `${projectPath}\0${subjectKey}`;
}

export function beginRun(projectPath: string, subjectKey: string, lensId: string): AbortController {
  const abort = new AbortController();
  live.set(keyFor(projectPath, subjectKey), { lensId, abort });
  return abort;
}

export function endRun(projectPath: string, subjectKey: string): void {
  live.delete(keyFor(projectPath, subjectKey));
}

/** The lens being written for this diff in this process, if any. */
export function liveRun(projectPath: string, subjectKey: string): string | null {
  return live.get(keyFor(projectPath, subjectKey))?.lensId ?? null;
}

/** Quitting. The stored mark stays, so the next launch reports it interrupted. */
export function abortLensRuns(): void {
  for (const run of live.values()) run.abort.abort();
  live.clear();
}
