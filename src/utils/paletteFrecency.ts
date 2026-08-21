/**
 * What the mod+K switcher remembers about where the user goes. A jump records
 * its target's key, which boosts that target's score and fills the "Recent"
 * group on an empty query.
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

/** Fire-and-forget: a lost write costs ranking quality, never correctness. */
export function persistFrecency(map: FrecencyMap): void {
  void window.api.globalSettings.set(SETTINGS_KEY, JSON.stringify(map));
}
