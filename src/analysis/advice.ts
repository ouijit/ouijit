import { TREND_RECENT_MONTHS, type FileComplexitySignal, type FileSignal } from './types';

export interface Lever {
  id: string;
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
    return [{ id: 'cooling', text: 'Cooling off. Leave it alone.' }];
  }

  const levers: Lever[] = [];
  const cx = signal.complexity;

  if (cx && cx.loc >= LARGE_LOC) {
    levers.push({ id: 'split', text: `${cx.loc} lines and still changing. Split it.` });
  }
  if (cx && cx.indentMax >= DEEP_NESTING) {
    levers.push({ id: 'flatten', text: `Nests ${cx.indentMax} deep. Flatten the worst path.` });
  }
  if (cx && cx.loc > 0 && signal.added + signal.deleted >= cx.loc * REWRITE_RATIO) {
    const times = Math.round((signal.added + signal.deleted) / cx.loc);
    levers.push({ id: 'churn', text: `Rewritten ${times}× over. Settle the interface.` });
  }

  const top = signal.topAuthors[0];
  if (top && top.share >= HELD_SHARE) {
    levers.push({ id: 'held', text: `${top.name} wrote ${pct(top.share)}%. Spread the read.` });
  } else if (signal.authorCount >= FRAGMENTED_AUTHORS && (!top || top.share < FRAGMENTED_SHARE)) {
    levers.push({ id: 'fragmented', text: `${signal.authorCount} authors, none dominant. Give it an owner.` });
  }

  if (partner && partner.degree >= SEAM_DEGREE) {
    levers.push({ id: 'seam', text: `Moves with ${basename(partner.path)} ${pct(partner.degree)}% of the time. Check the seam.` });
  }

  return levers.slice(0, MAX_LEVERS);
}

/** The complexity half of the score, in the units it was measured in. */
export function describeComplexity(cx: FileComplexitySignal): string {
  const avg = cx.loc > 0 ? cx.indentTotal / cx.loc : 0;
  return `${cx.loc} lines · average nesting ${avg.toFixed(1)} · deepest ${cx.indentMax}`;
}

/** The numbers a lever list is arguing from, in the order they are read. */
export function evidenceFor(signal: FileSignal): string[] {
  const lines: string[] = [];
  if (signal.complexity) lines.push(describeComplexity(signal.complexity));
  lines.push(`${signal.added + signal.deleted} lines written and removed`);
  lines.push(
    `${signal.trend.recent} of ${signal.trend.total} commits in the last ${TREND_RECENT_MONTHS} months`,
  );
  return lines;
}

function pct(share: number): number {
  return Math.round(share * 100);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
