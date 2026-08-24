import { describe, test, expect } from 'vitest';
import { scoreField, scoreFields, type SearchField } from '../utils/paletteScore';
import { frecencyBoost, recordUse } from '../utils/paletteFrecency';

/** A task's field set, mirroring what the palette builds. */
const TASK: SearchField[] = [
  { key: 'name', text: 'Cache invalidation', weight: 1 },
  { key: 'number', text: 'T-517', weight: 1 },
  { key: 'number', text: '517', weight: 0.9 },
  { key: 'branch', text: 'fix/cache-headers', weight: 0.7 },
  { key: 'project', text: 'Ouijit', weight: 0.5 },
  { key: 'status', text: 'in progress', weight: 0.4 },
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function score(query: string, field: SearchField): number {
  return scoreField(query, field)?.score ?? -Infinity;
}

describe('palette field scoring', () => {
  test('literal matches outrank scattered ones on the same field', () => {
    const field: SearchField = { key: 'name', text: 'Cache invalidation', weight: 1 };
    const exact = score('cache invalidation', field);
    const prefix = score('cache', field);
    const substring = score('invalid', field);
    const subsequence = score('cvl', field);

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);

    // A long query must not accumulate enough raw fzy score to climb a tier:
    // scattered stays below contiguous no matter how many characters agree.
    expect(score('caceinvaliation', field)).toBeLessThan(substring);
  });

  test('a low-weight field cannot outrank a high-weight one by matching harder', () => {
    // "in progress" is this task's status exactly, but its name only starts
    // with "cache". The name still wins.
    const status = scoreFields('in progress', TASK);
    const name = scoreFields('cache', TASK);
    expect(status?.key).toBe('status');
    expect(name?.key).toBe('name');
    expect(name?.score).toBeGreaterThan(status?.score ?? 0);
  });

  test('a task is reachable by number in either form, and reports the field that matched', () => {
    expect(scoreFields('t-517', TASK)?.key).toBe('number');
    expect(scoreFields('517', TASK)?.key).toBe('number');

    const branch = scoreFields('cache-headers', TASK);
    expect(branch?.key).toBe('branch');
    expect(branch?.text).toBe('fix/cache-headers');
    // Ranges point at the matched run so the row can highlight it.
    expect(branch?.ranges).toEqual([[4, 17]]);
  });

  test('no match on any field is no match', () => {
    expect(scoreFields('zzzz', TASK)).toBeNull();
    expect(scoreFields('', TASK)).toBeNull();
  });
});

describe('palette frecency', () => {
  test('recency and repetition both count, and the boost stays under one tier', () => {
    const now = 10 * DAY;
    const justNow = frecencyBoost({ visitedAtMs: now - HOUR, visits: 1 }, now);
    const lastWeek = frecencyBoost({ visitedAtMs: now - 7 * DAY, visits: 1 }, now);
    const habitual = frecencyBoost({ visitedAtMs: now - 7 * DAY, visits: 20 }, now);

    expect(justNow).toBeGreaterThan(lastWeek);
    expect(habitual).toBeGreaterThan(lastWeek);
    expect(frecencyBoost(undefined, now)).toBe(0);

    // TIER_STEP is 10: frecency reorders comparable matches, it never lifts a
    // weak match above a literal one.
    expect(frecencyBoost({ visitedAtMs: now, visits: 1000 }, now)).toBeLessThan(10);
  });

  test('a repeat visit accumulates rather than resetting', () => {
    const first = recordUse({}, 'task:/p#1', 1000);
    const second = recordUse(first, 'task:/p#1', 2000);
    expect(second['task:/p#1']).toEqual({ visitedAtMs: 2000, visits: 2 });
  });
});
