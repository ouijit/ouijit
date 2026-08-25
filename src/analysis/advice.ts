import { ANALYSIS_WINDOW_MONTHS, type FileComplexitySignal, type FileSignal } from './types';

/** Named so a surface rendering levers can map every one to an icon. */
export type LeverId = 'cooling' | 'split' | 'flatten' | 'churn' | 'held' | 'fragmented' | 'seam';

export interface Lever {
  id: LeverId;
  text: string;
}

const LARGE_LOC = 400;
const DEEP_NESTING = 6;
/** Lines written and removed, over the file's current size. */
const REWRITE_RATIO = 5;
const HELD_SHARE = 0.8;
const FRAGMENTED_SHARE = 0.35;
const FRAGMENTED_AUTHORS = 4;
const SEAM_DEGREE = 0.7;
const MAX_LEVERS = 3;

/**
 * The rules of thumb behind a hotspot, as the one move each argues for.
 * Nothing fires for a quiet file, and a file whose numbers say nothing in
 * particular gets no levers rather than a filler one.
 */
export function leversFor(signal: FileSignal, partner?: { path: string; degree: number } | null): Lever[] {
  if (signal.tier === 'quiet') return [];

  // Every other lever pays its cost now against changes that are no longer
  // coming, so a file that has stopped moving argues against all of them.
  if (signal.trend.direction === 'cooling') {
    return [{ id: 'cooling', text: 'Cooling off — probably best left alone' }];
  }

  const levers: Lever[] = [];
  const cx = signal.complexity;

  if (cx && cx.loc >= LARGE_LOC) {
    levers.push({ id: 'split', text: 'Large and still changing — worth splitting' });
  }
  if (cx && cx.indentMax >= DEEP_NESTING) {
    levers.push({ id: 'flatten', text: 'Nests deeply — worth flattening the worst path' });
  }
  if (cx && cx.loc > 0 && signal.added + signal.deleted >= cx.loc * REWRITE_RATIO) {
    levers.push({ id: 'churn', text: 'Rewritten many times over — the interface may not have settled' });
  }

  const top = signal.topAuthors[0];
  if (top && top.share >= HELD_SHARE) {
    levers.push({ id: 'held', text: 'Held by one author — worth a second reader' });
  } else if (signal.authorCount >= FRAGMENTED_AUTHORS && (!top || top.share < FRAGMENTED_SHARE)) {
    levers.push({ id: 'fragmented', text: 'No dominant author — worth giving it an owner' });
  }

  if (partner && partner.degree >= SEAM_DEGREE) {
    levers.push({ id: 'seam', text: `Usually changes with ${basename(partner.path)} — worth checking the seam` });
  }

  return levers.slice(0, MAX_LEVERS);
}

export function describeNesting(cx: FileComplexitySignal): string {
  const avg = cx.loc > 0 ? cx.indentTotal / cx.loc : 0;
  return `nests ${cx.indentMax} deep, ${avg.toFixed(1)} on average`;
}

export function describeFrequency(signal: FileSignal): string {
  return `${signal.commits} ${signal.commits === 1 ? 'commit' : 'commits'} in ${ANALYSIS_WINDOW_MONTHS} months`;
}

export interface Measure {
  value: string;
  label: string;
}

/** How big the file is and how much of it has moved, as figures rather than a sentence. */
export function measuresFor(signal: FileSignal): Measure[] {
  const churn: Measure = {
    value: (signal.added + signal.deleted).toLocaleString(),
    label: 'lines changed',
  };
  if (!signal.complexity) return [churn];
  return [{ value: signal.complexity.loc.toLocaleString(), label: 'lines' }, churn];
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
