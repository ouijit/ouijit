import { describe, test, expect } from 'vitest';
import { stackWindow, turnPage } from '../components/terminal/stackWindow';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

describe('stack pagination', () => {
  test('shows the page holding the active terminal, and turning pages moves only the window', () => {
    const ordered = ids(12);
    const first = stackWindow(ordered, 't0');
    expect(first).toEqual({ ids: ['t0', 't1', 't2', 't3', 't4'], page: 0, pageCount: 3 });
    expect(turnPage(first, -1)).toBeNull();

    const second = stackWindow(ordered, 't0', turnPage(first, 1));
    expect(second.ids).toEqual(['t5', 't6', 't7', 't8', 't9']);
    const last = stackWindow(ordered, 't0', turnPage(second, 1));
    expect(last.ids).toEqual(['t10', 't11']);
    expect(turnPage(last, 1)).toBeNull();
    expect(ordered).toEqual(ids(12));

    expect(stackWindow(ordered, 't7').page).toBe(1);
    expect(stackWindow(ordered, 't0', 9).page).toBe(2);
    expect(stackWindow([], undefined)).toEqual({ ids: [], page: 0, pageCount: 1 });
  });
});
