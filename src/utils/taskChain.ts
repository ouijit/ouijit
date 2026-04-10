import type { TaskWithWorkspace } from '../types';

export interface TaskChainInfo {
  rootTaskNumber: number;
  depth: number;
  childTaskNumbers: number[];
}

/**
 * Build a map of chain info for all tasks in a project.
 * Walks parent chains to compute root and depth for each task.
 */
export function buildChainMap(tasks: TaskWithWorkspace[]): Map<number, TaskChainInfo> {
  const byNumber = new Map(tasks.map((t) => [t.taskNumber, t]));
  const childrenMap = new Map<number, number[]>();
  const result = new Map<number, TaskChainInfo>();

  // Build children index
  for (const task of tasks) {
    if (task.parentTaskNumber != null) {
      const siblings = childrenMap.get(task.parentTaskNumber);
      if (siblings) {
        siblings.push(task.taskNumber);
      } else {
        childrenMap.set(task.parentTaskNumber, [task.taskNumber]);
      }
    }
  }

  // Compute root + depth for each task via parent walk, memoizing as we go
  function resolve(taskNumber: number): { root: number; depth: number } {
    const cached = result.get(taskNumber);
    if (cached) return { root: cached.rootTaskNumber, depth: cached.depth };

    const task = byNumber.get(taskNumber);
    if (!task?.parentTaskNumber || !byNumber.has(task.parentTaskNumber)) {
      result.set(taskNumber, {
        rootTaskNumber: taskNumber,
        depth: 0,
        childTaskNumbers: childrenMap.get(taskNumber) ?? [],
      });
      return { root: taskNumber, depth: 0 };
    }

    const parent = resolve(task.parentTaskNumber);
    const info = {
      rootTaskNumber: parent.root,
      depth: parent.depth + 1,
      childTaskNumbers: childrenMap.get(taskNumber) ?? [],
    };
    result.set(taskNumber, info);
    return { root: parent.root, depth: parent.depth + 1 };
  }

  for (const task of tasks) {
    resolve(task.taskNumber);
  }

  return result;
}

/** Deterministic hue from root task number (golden angle for good distribution). */
export function getChainHue(rootTaskNumber: number): number {
  return (rootTaskNumber * 137.508) % 360;
}

/** HSL color string for a badge at a given depth within a chain. */
export function getChainColor(rootTaskNumber: number, depth: number): string {
  const hue = getChainHue(rootTaskNumber);
  const lightness = Math.max(72 - depth * 14, 30);
  return `hsl(${hue}, 55%, ${lightness}%)`;
}

/** Semi-transparent background for badge. */
export function getChainBgColor(rootTaskNumber: number, depth: number): string {
  const hue = getChainHue(rootTaskNumber);
  const lightness = Math.max(72 - depth * 14, 30);
  return `hsla(${hue}, 55%, ${lightness}%, 0.15)`;
}

/** Check if possibleDescendant is a descendant of ancestor in the chain map. */
export function isDescendantOf(
  possibleDescendant: number,
  ancestor: number,
  chainMap: Map<number, TaskChainInfo>,
): boolean {
  const queue = [...(chainMap.get(ancestor)?.childTaskNumbers ?? [])];
  const visited = new Set<number>();
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current === possibleDescendant) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const children = chainMap.get(current)?.childTaskNumbers;
    if (children) queue.push(...children);
  }
  return false;
}
