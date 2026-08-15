/**
 * An unknown thrown value as something worth putting in front of a person.
 *
 * The renderer's own version: `describeError` in `github/service.ts` narrows a
 * GithubError and lives in main, so importing that one here would pull the
 * whole GitHub client into the renderer bundle.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
