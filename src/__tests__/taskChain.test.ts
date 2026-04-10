import { describe, test, expect } from 'vitest';
import { buildChainMap, getChainColor, getChainBgColor, getChainHue } from '../utils/taskChain';
import type { TaskWithWorkspace } from '../types';

function task(num: number, parent?: number): TaskWithWorkspace {
  return {
    taskNumber: num,
    name: `Task ${num}`,
    status: 'in_progress',
    createdAt: '2024-01-01',
    parentTaskNumber: parent,
  };
}

describe('buildChainMap', () => {
  test('standalone tasks have depth 0 and root = self', () => {
    const map = buildChainMap([task(1), task(2)]);

    expect(map.get(1)).toEqual({ rootTaskNumber: 1, depth: 0, childTaskNumbers: [] });
    expect(map.get(2)).toEqual({ rootTaskNumber: 2, depth: 0, childTaskNumbers: [] });
  });

  test('parent-child chain computes correct depth and root', () => {
    const map = buildChainMap([task(1), task(2, 1), task(3, 2)]);

    expect(map.get(1)!.rootTaskNumber).toBe(1);
    expect(map.get(1)!.depth).toBe(0);
    expect(map.get(1)!.childTaskNumbers).toEqual([2]);

    expect(map.get(2)!.rootTaskNumber).toBe(1);
    expect(map.get(2)!.depth).toBe(1);
    expect(map.get(2)!.childTaskNumbers).toEqual([3]);

    expect(map.get(3)!.rootTaskNumber).toBe(1);
    expect(map.get(3)!.depth).toBe(2);
    expect(map.get(3)!.childTaskNumbers).toEqual([]);
  });

  test('multiple children of same parent', () => {
    const map = buildChainMap([task(1), task(2, 1), task(3, 1)]);

    expect(map.get(1)!.childTaskNumbers).toEqual([2, 3]);
    expect(map.get(2)!.depth).toBe(1);
    expect(map.get(3)!.depth).toBe(1);
    expect(map.get(2)!.rootTaskNumber).toBe(1);
    expect(map.get(3)!.rootTaskNumber).toBe(1);
  });

  test('orphaned parentTaskNumber (parent not in list) treated as root', () => {
    const map = buildChainMap([task(5, 99)]);

    expect(map.get(5)!.rootTaskNumber).toBe(5);
    expect(map.get(5)!.depth).toBe(0);
  });

  test('empty task list returns empty map', () => {
    const map = buildChainMap([]);
    expect(map.size).toBe(0);
  });
});

describe('getChainColor / getChainBgColor', () => {
  test('returns valid HSL string', () => {
    expect(getChainColor(1, 0)).toMatch(/^hsl\(\d+(\.\d+)?, 55%, \d+%\)$/);
    expect(getChainBgColor(1, 0)).toMatch(/^hsla\(\d+(\.\d+)?, 55%, \d+%, 0\.15\)$/);
  });

  test('deeper depth produces lower lightness', () => {
    const light0 = parseInt(getChainColor(1, 0).match(/(\d+)%\)/)![1]);
    const light1 = parseInt(getChainColor(1, 1).match(/(\d+)%\)/)![1]);
    const light2 = parseInt(getChainColor(1, 2).match(/(\d+)%\)/)![1]);

    expect(light0).toBeGreaterThan(light1);
    expect(light1).toBeGreaterThan(light2);
  });

  test('lightness has a floor of 30%', () => {
    const lightDeep = parseInt(getChainColor(1, 100).match(/(\d+)%\)/)![1]);
    expect(lightDeep).toBe(30);
  });

  test('different root task numbers produce different hues', () => {
    expect(getChainHue(1)).not.toBe(getChainHue(2));
  });
});
