/**
 * What the mod+K switcher remembers about where the user spends time. A visit
 * records its subject's key, which boosts that subject's score and fills the
 * "Recent" group on an empty query. `visitTracker` decides what counts as one.
 *
 * Keys must outlive what they describe: a task keeps one key across every
 * worktree shell it spawns. Loose terminals key on their ptyId instead and are
 * pruned once the session is gone.
 */

const SETTINGS_KEY = 'ui:palette-visits';

/** Recency halves every three days. */
const HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;
/** Ceiling on the boost. Below `TIER_STEP`, so frecency reorders rows within a
 *  match tier but never lifts a weak match above a literal one. */
const MAX_BOOST = 3;
/** log2(1 + count) saturates here, so a hot item stops pulling away at ~15 uses. */
const COUNT_SATURATION = 4;
/** Recency leads, but a long-standing habit still counts for something. */
const RECENCY_SHARE = 0.7;
/** Cap on persisted entries, oldest dropped first. */
const MAX_ENTRIES = 200;

export interface FrecencyEntry {
  visitedAtMs: number;
  visits: number;
}

export type FrecencyMap = Record<string, FrecencyEntry>;

export const projectKey = (path: string): string => `project:${path}`;
export const taskKey = (projectPath: string, taskNumber: number): string => `task:${projectPath}#${taskNumber}`;
export const terminalKey = (ptyId: string): string => `terminal:${ptyId}`;
export const pullKey = (projectPath: string, prNumber: number): string => `pull:${projectPath}#${prNumber}`;

/**
 * A shell and a pull request each borrow the identity of the task that claims
 * it, because the palette lists no row of their own in that case. A key
 * recorded against no row would take its boost nowhere.
 */
export function terminalTaskNumber(
  terminal: { projectPath: string; taskId?: number | null },
  taskCacheByProject: Record<string, readonly { taskNumber: number }[] | undefined>,
): number | null {
  const { projectPath, taskId } = terminal;
  if (taskId == null) return null;
  return (taskCacheByProject[projectPath] ?? []).some((t) => t.taskNumber === taskId) ? taskId : null;
}

export function pullTaskNumber(
  projectPath: string,
  prNumber: number,
  taskCacheByProject: Record<string, readonly { taskNumber: number; githubPrNumber?: number | null }[] | undefined>,
): number | null {
  return (taskCacheByProject[projectPath] ?? []).find((t) => t.githubPrNumber === prNumber)?.taskNumber ?? null;
}

/** 0..MAX_BOOST, added to a row's match score. */
export function frecencyBoost(entry: FrecencyEntry | undefined, now: number): number {
  if (!entry) return 0;
  const age = Math.max(0, now - entry.visitedAtMs);
  const recency = Math.pow(0.5, age / HALF_LIFE_MS);
  const frequency = Math.min(1, Math.log2(1 + entry.visits) / COUNT_SATURATION);
  return MAX_BOOST * (RECENCY_SHARE * recency + (1 - RECENCY_SHARE) * frequency);
}

/** Pure — `recordVisit` is what persists. */
export function recordUse(map: FrecencyMap, key: string, now: number): FrecencyMap {
  const previous = map[key];
  const next: FrecencyMap = { ...map, [key]: { visitedAtMs: now, visits: (previous?.visits ?? 0) + 1 } };
  const keys = Object.keys(next);
  if (keys.length <= MAX_ENTRIES) return next;
  // Drop the least recently used. Dead ptyIds accumulate here otherwise.
  keys.sort((a, b) => next[b].visitedAtMs - next[a].visitedAtMs);
  const pruned: FrecencyMap = {};
  for (const k of keys.slice(0, MAX_ENTRIES)) pruned[k] = next[k];
  return pruned;
}

async function loadFrecency(): Promise<FrecencyMap> {
  try {
    const raw = await window.api.globalSettings.get(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as FrecencyMap) : {};
  } catch {
    return {};
  }
}

/**
 * How long a burst of visits coalesces before one write. Longer than
 * `visitTracker`'s dwell, or every settled view would be its own write.
 */
const FLUSH_DELAY_MS = 3000;

let cached: Promise<FrecencyMap> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The live map. Nothing outside this module writes the setting, so the first
 * read is the only one: visits are applied in memory from there on, and the
 * palette ranks against a map that already has the visit that preceded it.
 */
export function frecencyMap(): Promise<FrecencyMap> {
  cached ??= loadFrecency();
  return cached;
}

export function resetFrecencyForTests(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  cached = null;
}

/**
 * Record a visit to `key`. Persisting is deferred and coalesced, so a burst
 * costs one write; a visit made in the last `FLUSH_DELAY_MS` before a hard quit
 * is lost, which costs ranking quality and never correctness.
 */
export function recordVisit(key: string): void {
  const now = Date.now();
  cached = frecencyMap().then((map) => recordUse(map, key, now));
  // The window runs from the first visit of a burst, not the last: restarting
  // it per visit lets a steady stream of them postpone the write indefinitely.
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void frecencyMap()
      .then((map) => window.api.globalSettings.set(SETTINGS_KEY, JSON.stringify(map)))
      .catch(() => {});
  }, FLUSH_DELAY_MS);
}
