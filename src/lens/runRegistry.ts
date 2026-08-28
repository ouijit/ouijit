/**
 * A row in `diff_lenses` marked running says an agent was started for that diff.
 * Whether it is still going is only knowable here, and this does not survive a
 * quit — which is how an interrupted run is told from a live one.
 */

interface LiveRun {
  lensId: string;
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

export function liveRun(projectPath: string, subjectKey: string): string | null {
  return live.get(keyFor(projectPath, subjectKey))?.lensId ?? null;
}

/** The stored mark is left, so the next launch reports the run interrupted. */
export function abortLensRuns(): void {
  for (const run of live.values()) run.abort.abort();
  live.clear();
}
