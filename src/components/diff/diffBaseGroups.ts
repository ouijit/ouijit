import type { DiffBaseRef, DiffBases } from '../../types';
import { fuzzyMatch } from '../../utils/fuzzyMatch';

export const MAX_BASE_ROWS = 15;

export interface DiffBaseRow {
  ref: string;
  /** Role this ref plays for the branch; unset for plain rows. */
  hint?: string;
}

export interface DiffBaseGroups {
  roles: DiffBaseRow[];
  /** Alphabetical, capped at `MAX_BASE_ROWS`. */
  rest: DiffBaseRow[];
  hidden: number;
}

export interface DiffBaseContext {
  branch: string | null;
  /** What the branch merges into — a task's target, or the main branch. */
  base: string | null;
  mainBranch: string | null;
}

/**
 * Splits the refs into ones with a role for this branch and the rest.
 *
 * A role ref that git doesn't have — a branch never pushed, say — is dropped
 * rather than offered, since diffing against it would fail.
 */
export function groupDiffBases(bases: DiffBases, context: DiffBaseContext): DiffBaseGroups {
  const present = new Map(bases.refs.map((r) => [r.ref, r]));
  const roles: DiffBaseRow[] = [];
  const claimed = new Set<string>();

  const role = (ref: string | null, hint: string) => {
    if (!ref || ref === context.branch || claimed.has(ref) || !present.has(ref)) return;
    claimed.add(ref);
    roles.push({ ref, hint });
  };

  const remote = bases.defaultRemote;
  const onRemote = (branch: string | null) => (remote && branch ? `${remote}/${branch}` : null);

  role(context.base, 'base');
  role(onRemote(context.base), remote ? `base on ${remote}` : 'base');
  role(context.mainBranch, 'main');
  role(onRemote(context.mainBranch), remote ? `main on ${remote}` : 'main');
  role(bases.upstream, 'pushed');

  const rest = bases.refs.filter((r) => r.ref !== context.branch && !claimed.has(r.ref)).map((r) => ({ ref: r.ref }));

  return { roles, rest: rest.slice(0, MAX_BASE_ROWS), hidden: Math.max(0, rest.length - MAX_BASE_ROWS) };
}

/**
 * Ranked matches for a query, flat so the best match is the first row — a
 * grouped list would only make it the best match within its group. Remote refs
 * also match on their branch name, so `main` finds `origin/main`.
 */
export function searchDiffBases(refs: readonly DiffBaseRef[], query: string, branch: string | null): DiffBaseRow[] {
  const scored: { ref: string; score: number; remote: boolean }[] = [];
  for (const candidate of refs) {
    if (candidate.ref === branch) continue;
    const onRef = fuzzyMatch(query, candidate.ref);
    const onBranch = candidate.remote ? fuzzyMatch(query, candidate.branch) : null;
    const score = Math.max(onRef?.score ?? -Infinity, onBranch?.score ?? -Infinity);
    if (score > -Infinity) scored.push({ ref: candidate.ref, score, remote: candidate.remote !== null });
  }
  // A branch and its remote score identically on a branch-name query; prefer
  // the local one.
  scored.sort((a, b) => b.score - a.score || Number(a.remote) - Number(b.remote) || a.ref.localeCompare(b.ref));
  return scored.map(({ ref }) => ({ ref }));
}
