import type { DiffBaseRef, DiffBases } from '../../types';
import { fuzzyMatch } from '../../utils/fuzzyMatch';

/** How many branches the list shows before saying how many it is holding back. */
export const MAX_BASE_ROWS = 15;

/** One offered ref, and why it is being offered where it is. */
export interface DiffBaseRow {
  ref: string;
  /** What this ref is to the branch being read — absent in the full list. */
  hint?: string;
}

export interface DiffBaseGroups {
  /** The refs that mean something to this branch, in the order they matter. */
  roles: DiffBaseRow[];
  /** Everything else, alphabetically, cut to `MAX_BASE_ROWS`. */
  rest: DiffBaseRow[];
  /** How many the cut left out, so the list can say so. */
  hidden: number;
}

export interface DiffBaseContext {
  /** The branch being read, which cannot also be what it is read against. */
  branch: string | null;
  /** What this branch merges into — a task's target, or the main branch. */
  base: string | null;
  /** The project's main branch, when it is not the base already. */
  mainBranch: string | null;
}

/**
 * The refs on offer, split into the ones that answer a question about this
 * branch and the ones that are merely available.
 *
 * The roles are what the branch merges into, that base as the remote has it,
 * and the branch itself as pushed — the "what have I not sent yet" reading. A
 * ref that isn't there, a branch never pushed among them, is left out rather
 * than offered and broken.
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
 * Ranked matches for a query, as one flat list.
 *
 * Flat rather than grouped, for the reason the switcher is: the best match has
 * to be the first row, and a grouped list makes it the best match within its
 * group instead. Matched on the branch name as well as the whole ref, so
 * typing `main` finds `origin/main` without also typing the remote.
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
  // A branch and its remote match a query on the branch name identically, and
  // the local one is the one being asked for by that name.
  scored.sort((a, b) => b.score - a.score || Number(a.remote) - Number(b.remote) || a.ref.localeCompare(b.ref));
  return scored.map(({ ref }) => ({ ref }));
}
