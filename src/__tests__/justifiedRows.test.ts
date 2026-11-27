import { test, expect } from 'vitest';
import { justifiedRows, type Box } from '../components/chat/justifiedImages';

/** The boxes as rows: consecutive boxes at one height. */
function rows(boxes: Box[]): Box[][] {
  const out: Box[][] = [];
  for (const box of boxes) {
    const last = out.at(-1);
    if (last && last[0].height === box.height) last.push(box);
    else out.push([box]);
  }
  return out;
}
const span = (row: Box[], gap = 6) => row.reduce((sum, box) => sum + box.width, 0) + gap * (row.length - 1);

test('images share a height within a row, keep their shape, and fill the column edge to edge', () => {
  // Two wide shots side by side: one row, the full width, each at its own 2:1.
  const two = justifiedRows([2, 2], 700);
  expect(rows(two)).toHaveLength(1);
  expect(span(two)).toBe(700);
  for (const box of two) expect(box.width / box.height).toBeCloseTo(2, 1);

  // A portrait beside two wide ones gets less width, and none is letterboxed: each box is its image's shape.
  const mixed = justifiedRows([16 / 9, 2 / 3, 16 / 9], 700);
  expect(rows(mixed)).toHaveLength(1);
  expect(span(mixed)).toBe(700);
  expect(mixed[1].width).toBeLessThan(mixed[0].width / 2);
  [16 / 9, 2 / 3, 16 / 9].forEach((aspect, i) => expect(mixed[i].width / mixed[i].height).toBeCloseTo(aspect, 1));

  // Too many for one row at a comfortable height wrap into several, each full and near the target.
  const many = justifiedRows([1.5, 1, 16 / 9, 2 / 3, 1.5, 4 / 3, 1, 16 / 9], 700);
  const wrapped = rows(many);
  expect(wrapped.length).toBeGreaterThan(1);
  for (const row of wrapped.slice(0, -1)) {
    expect(span(row)).toBe(700);
    expect(row[0].height).toBeGreaterThanOrEqual(150);
    expect(row[0].height).toBeLessThan(300);
  }

  // A short last row stops at the target height rather than stretching to the edge.
  const leftover = justifiedRows([1.5, 1.5, 1.5, 1.5, 1], 700);
  const last = rows(leftover).at(-1)!;
  expect(last[0].height).toBe(230);
  expect(span(last)).toBeLessThan(700);
});
