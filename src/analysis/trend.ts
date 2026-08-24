import { TREND_RECENT_MONTHS, type Trend, type TrendDirection } from './types';

/** Below this a change in rate is as likely to be noise as a direction. */
const MIN_COMMITS = 4;
const RISING_RATIO = 1.5;
/**
 * The window's last month is the calendar month in progress, so the recent
 * rate is understated by up to a third. The cooling threshold sits low enough
 * that a partial month alone cannot cross it.
 */
const COOLING_RATIO = 0.5;

/** Direction of travel from a monthly commit series, oldest month first. */
export function trendOf(monthly: readonly number[]): Trend {
  const cut = Math.max(0, monthly.length - TREND_RECENT_MONTHS);
  const recent = sum(monthly.slice(cut));
  const prior = sum(monthly.slice(0, cut));
  const total = recent + prior;

  let direction: TrendDirection = 'steady';
  if (total >= MIN_COMMITS) {
    const recentRate = recent / Math.max(1, monthly.length - cut);
    const priorRate = prior / Math.max(1, cut);
    if (prior === 0) direction = 'new';
    else if (recentRate >= priorRate * RISING_RATIO) direction = 'rising';
    else if (recentRate <= priorRate * COOLING_RATIO) direction = 'cooling';
  }

  return { direction, recent, total };
}

function sum(ns: readonly number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}
