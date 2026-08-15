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
