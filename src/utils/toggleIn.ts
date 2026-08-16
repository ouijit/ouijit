/**
 * A Set with one member added or removed, as a new Set.
 *
 * For `setState` updaters over a Set of ids — folded files, collapsed groups —
 * which have to copy rather than mutate for React to see the change.
 */
export function toggleIn<T>(set: ReadonlySet<T>, value: T, present: boolean): Set<T> {
  const next = new Set(set);
  if (present) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * The same, for the lists that cross the IPC boundary and are stored as JSON.
 * Adding is deduped, since these are membership lists.
 */
export function toggleInList<T>(list: readonly T[], value: T, present: boolean): T[] {
  if (!present) return list.filter((entry) => entry !== value);
  return list.includes(value) ? [...list] : [...list, value];
}
