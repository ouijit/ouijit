/**
 * What the mod+K switcher remembers about where the user goes. Every surface
 * that jumps somewhere — the switcher, the sidebar, the board, the card
 * stacks — records its target's key here, which boosts that target's score
 * and fills the "Recent" group on an empty query. Recorded only through the
 * switcher, the group would show where the switcher had been rather than
 * where the user has been.
 *
 * Keys must outlive what they describe: a task keeps one key across every
 * worktree shell it spawns. Loose terminals key on their ptyId instead and are
 * pruned once the session is gone.
 */

const SETTINGS_KEY = 'ui:palette-frecency';

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
  /** Epoch ms of the most recent jump. */
  at: number;
  /** Total jumps. */
  n: number;
}

export type FrecencyMap = Record<string, FrecencyEntry>;

export const projectKey = (path: string): string => `project:${path}`;
export const taskKey = (projectPath: string, taskNumber: number): string => `task:${projectPath}#${taskNumber}`;
export const terminalKey = (ptyId: string): string => `terminal:${ptyId}`;
export const pullKey = (projectPath: string, prNumber: number): string => `pull:${projectPath}#${prNumber}`;

/**
 * The key a live shell answers to: its task's, so every worktree shell feeds
 * the task's entry, or its own ptyId when no cached task claims it. The jump
 * recorder and the palette's row builder both resolve through here — the
 * recorded key must be one a row carries, or the boost lands nowhere.
 */
export function terminalFrecencyKey(
  ptyId: string,
  terminal: { projectPath: string; taskId?: number | null },
  taskCacheByProject: Record<string, readonly { taskNumber: number }[] | undefined>,
): string {
  const { projectPath, taskId } = terminal;
  if (taskId != null && (taskCacheByProject[projectPath] ?? []).some((t) => t.taskNumber === taskId)) {
    return taskKey(projectPath, taskId);
  }
  return terminalKey(ptyId);
}

/** 0..MAX_BOOST, added to a row's match score. */
export function frecencyBoost(entry: FrecencyEntry | undefined, now: number): number {
  if (!entry) return 0;
  const age = Math.max(0, now - entry.at);
  const recency = Math.pow(0.5, age / HALF_LIFE_MS);
  const frequency = Math.min(1, Math.log2(1 + entry.n) / COUNT_SATURATION);
  return MAX_BOOST * (RECENCY_SHARE * recency + (1 - RECENCY_SHARE) * frequency);
}

/** Record a jump, returning the next map. Pure — the caller persists it. */
export function recordUse(map: FrecencyMap, key: string, now: number): FrecencyMap {
  const previous = map[key];
  const next: FrecencyMap = { ...map, [key]: { at: now, n: (previous?.n ?? 0) + 1 } };
  const keys = Object.keys(next);
  if (keys.length <= MAX_ENTRIES) return next;
  // Drop the least recently used. Dead ptyIds accumulate here otherwise.
  keys.sort((a, b) => next[b].at - next[a].at);
  const pruned: FrecencyMap = {};
  for (const k of keys.slice(0, MAX_ENTRIES)) pruned[k] = next[k];
  return pruned;
}

/** Reads the persisted map; an unreadable or malformed value is simply empty. */
export async function loadFrecency(): Promise<FrecencyMap> {
  try {
    const raw = await window.api.globalSettings.get(SETTINGS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: FrecencyMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<FrecencyEntry>;
      if (typeof entry?.at === 'number' && typeof entry?.n === 'number') map[key] = { at: entry.at, n: entry.n };
    }
    return map;
  } catch {
    return {};
  }
}

let lastJump: Promise<void> = Promise.resolve();

/**
 * Record a jump to `key`. Chained rather than fired off: concurrent jumps —
 * the home panel's bulk open — would each read the same base map and lose all
 * but the last write. A failed write costs ranking quality, never correctness.
 */
export function recordJump(key: string): void {
  lastJump = lastJump
    .then(async () => {
      const map = await loadFrecency();
      await window.api.globalSettings.set(SETTINGS_KEY, JSON.stringify(recordUse(map, key, Date.now())));
    })
    .catch(() => {});
}
