import type { AnalysisModel } from './accumulate';
import type { FileComplexitySignal, HotspotTier } from './types';

export interface FileScore {
  score: number;
  tier: HotspotTier;
}

const HOT_SCORE = 0.85;
const WARM_SCORE = 0.65;
/** Rank floors alone misfire in tiny histories, where two commits can top the list. */
const HOT_MIN_COMMITS = 5;
const WARM_MIN_COMMITS = 3;

/**
 * Hotspot score: the geometric mean of a file's percentile rank for change
 * frequency (among every file in the window) and for complexity (among the
 * files complexity was read for). A file without complexity stays quiet —
 * a hotspot is frequently changed AND complicated, and complexity is read
 * for every file frequent enough to qualify.
 */
export function scoreFiles(
  model: AnalysisModel,
  complexity: ReadonlyMap<string, FileComplexitySignal>,
): Map<string, FileScore> {
  const freqRank = percentileRanks([...model.files].map(([path, stats]) => [path, stats.commits]));
  const cxRank = percentileRanks([...complexity].map(([path, cx]) => [path, cx.indentTotal]));

  const scores = new Map<string, FileScore>();
  for (const [path, stats] of model.files) {
    const cr = cxRank.get(path);
    const score = cr == null ? 0 : Math.sqrt((freqRank.get(path) ?? 0) * cr);
    let tier: HotspotTier = 'quiet';
    if (score >= HOT_SCORE && stats.commits >= HOT_MIN_COMMITS) tier = 'hot';
    else if (score >= WARM_SCORE && stats.commits >= WARM_MIN_COMMITS) tier = 'warm';
    scores.set(path, { score, tier });
  }
  return scores;
}

/** Mid-rank percentiles, 0..1: ties share the middle of their group. */
function percentileRanks(entries: Array<[string, number]>): Map<string, number> {
  const ranks = new Map<string, number>();
  const n = entries.length;
  if (n === 0) return ranks;

  const sorted = [...entries].sort((a, b) => a[1] - b[1]);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && sorted[j][1] === sorted[i][1]) j++;
    const rank = (i + (j - i - 1) / 2) / n;
    for (let k = i; k < j; k++) ranks.set(sorted[k][0], rank);
    i = j;
  }
  return ranks;
}
