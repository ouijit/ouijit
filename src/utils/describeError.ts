/**
 * An unknown thrown value as something worth putting in front of a person.
 *
 * Dependency-free on purpose: main and the renderer both reach for this, so it
 * must not drag anything into either bundle.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
