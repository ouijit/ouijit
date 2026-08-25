import { basename } from './paths';
import {
  ANALYSIS_WINDOW_MONTHS,
  TREND_RECENT_MONTHS,
  type FileComplexitySignal,
  type FileSignal,
  type Partner,
  type Trend,
  type TrendDirection,
} from './types';

/** Named so a surface rendering levers can map every one to an icon. */
export type LeverId = 'cooling' | 'split' | 'flatten' | 'churn' | 'held' | 'fragmented' | 'seam';

interface Lever {
  id: LeverId;
  text: string;
}

const LARGE_LOC = 400;
const DEEP_NESTING = 6;
/** Lines written and removed, over the file's current size. */
const REWRITE_RATIO = 5;
const HELD_SHARE = 0.8;
const MAIN_AUTHOR_SHARE = 0.5;
const FRAGMENTED_SHARE = 0.35;
const FRAGMENTED_AUTHORS = 4;
const SEAM_DEGREE = 0.7;
const MAX_LEVERS = 3;

/** The rules of thumb behind a hotspot, as the one move each argues for. */
export function leversFor(signal: FileSignal, partner?: Partner | null): Lever[] {
  if (signal.tier === 'quiet') return [];

  // Every other lever pays its cost now against changes that are no longer
  // coming, so a file that has stopped moving argues against all of them.
  if (signal.trend.direction === 'cooling') {
    return [{ id: 'cooling', text: 'Cooling off · probably best left alone' }];
  }

  const levers: Lever[] = [];
  const cx = signal.complexity;

  if (cx && cx.loc >= LARGE_LOC) {
    levers.push({ id: 'split', text: 'Large and still changing · worth splitting' });
  }
  if (cx && cx.indentMax >= DEEP_NESTING) {
    levers.push({ id: 'flatten', text: 'Nests deeply · worth flattening the worst path' });
  }
  if (cx && cx.loc > 0 && signal.added + signal.deleted >= cx.loc * REWRITE_RATIO) {
    levers.push({ id: 'churn', text: 'Rewritten many times over · the interface may not have settled' });
  }

  const top = signal.topAuthors[0];
  if (top && top.share >= HELD_SHARE) {
    levers.push({ id: 'held', text: 'Held by one author · worth a second reader' });
  } else if (signal.authorCount >= FRAGMENTED_AUTHORS && (!top || top.share < FRAGMENTED_SHARE)) {
    levers.push({ id: 'fragmented', text: 'No dominant author · worth giving it an owner' });
  }

  if (partner && partner.degree >= SEAM_DEGREE) {
    levers.push({ id: 'seam', text: `${describePartner(basename(partner.path))} · worth checking the seam` });
  }

  return levers.slice(0, MAX_LEVERS);
}

/**
 * How every surface opens the sentence about a coupled pair. A prefix rather
 * than a whole sentence because the diff chip sets the partner in mono.
 */
export const PARTNER_PREFIX = 'Usually changes with';

export function describePartner(partner: string): string {
  return `${PARTNER_PREFIX} ${partner}`;
}

export function count(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
}

const TREND_WORD: Record<TrendDirection, string> = {
  new: 'All new',
  rising: 'Rising',
  steady: 'Steady',
  cooling: 'Cooling',
};

export function describeTrend(trend: Trend): string {
  const share = `${trend.recent} of ${count(trend.total, 'commit')} in the last ${TREND_RECENT_MONTHS} months`;
  return `${TREND_WORD[trend.direction]} · ${share}`;
}

export function describeNesting(cx: FileComplexitySignal): string {
  const avg = cx.loc > 0 ? cx.indentTotal / cx.loc : 0;
  return `nests ${cx.indentMax} deep, ${avg.toFixed(1)} on average`;
}

export function describeFrequency(signal: FileSignal): string {
  return `${count(signal.commits, 'commit')} in ${ANALYSIS_WINDOW_MONTHS} months`;
}

/** The author to ask about a file, if any one person holds enough of it. */
export function mainAuthorOf(signal: FileSignal): string | null {
  const top = signal.topAuthors[0];
  return top && top.share >= MAIN_AUTHOR_SHARE ? top.name : null;
}
