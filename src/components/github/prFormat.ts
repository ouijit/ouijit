/**
 * Presentation helpers for pull request state, checks, and reviews.
 *
 * Kept out of the components so the list badge, the detail header, and the
 * kanban card badge all describe the same PR the same way.
 */

import type { PullRequestSummary } from '../../github/types';
import { formatRelativeTime } from '../../utils/formatDate';

/** GitHub timestamps arrive as ISO strings; the shared formatter takes a Date. */
export function since(isoTimestamp: string): string {
  return formatRelativeTime(new Date(isoTimestamp));
}

export interface StateBadge {
  label: string;
  icon: string;
  /** Chip: a tinted background with matching text. */
  className: string;
  /** The same state as a bare glyph, where there is no chip to tint. */
  tone: string;
}

export function stateBadge(pr: Pick<PullRequestSummary, 'state' | 'isDraft'>): StateBadge {
  if (pr.state === 'merged') {
    return {
      label: 'Merged',
      icon: 'git-merge',
      className: 'bg-vcs-renamed/15 text-vcs-renamed',
      tone: 'text-vcs-renamed',
    };
  }
  if (pr.state === 'closed') {
    return {
      label: 'Closed',
      icon: 'x-circle',
      className: 'bg-vcs-deleted/15 text-vcs-deleted',
      tone: 'text-vcs-deleted',
    };
  }
  if (pr.isDraft) {
    return {
      label: 'Draft',
      icon: 'git-pull-request',
      className: 'bg-ink/[0.08] text-ink/50',
      tone: 'text-text-tertiary',
    };
  }
  return {
    label: 'Open',
    icon: 'git-pull-request',
    className: 'bg-vcs-added/15 text-vcs-added',
    tone: 'text-vcs-added',
  };
}

export type CheckOutcome = 'running' | 'passing' | 'failing' | 'neutral' | 'unknown';

/**
 * What one check amounts to, from GitHub's two overlapping fields.
 *
 * A check that has not finished has no conclusion worth reading, so status wins
 * over conclusion. Everything that counts a check — the list's glyph, the
 * summary's tally — asks this, so the two can't disagree about what failing is.
 */
export function checkOutcome(conclusion: string | null, status: string | null): CheckOutcome {
  if (status && status !== 'COMPLETED') return 'running';
  switch (conclusion) {
    case 'SUCCESS':
      return 'passing';
    case 'FAILURE':
    case 'ERROR':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
      return 'failing';
    case 'CANCELLED':
    case 'SKIPPED':
    case 'NEUTRAL':
      return 'neutral';
    case 'PENDING':
    case 'EXPECTED':
      return 'running';
    default:
      return 'unknown';
  }
}

const OUTCOME_APPEARANCE: Record<CheckOutcome, { icon: string; className: string }> = {
  running: { icon: 'clock', className: 'text-vcs-modified' },
  passing: { icon: 'check-circle', className: 'text-vcs-added' },
  failing: { icon: 'x-circle', className: 'text-vcs-deleted' },
  neutral: { icon: 'minus-circle', className: 'text-ink/35' },
  unknown: { icon: 'circle', className: 'text-ink/35' },
};

/** Icon + color for one entry in the checks list. */
export function checkRunAppearance(
  conclusion: string | null,
  status: string | null,
): { icon: string; className: string } {
  return OUTCOME_APPEARANCE[checkOutcome(conclusion, status)];
}

/** How a review event reads in the timeline. */
export function reviewStateLabel(state: string | undefined): string {
  switch (state) {
    case 'APPROVED':
      return 'approved these changes';
    case 'CHANGES_REQUESTED':
      return 'requested changes';
    case 'DISMISSED':
      return 'had their review dismissed';
    default:
      return 'reviewed';
  }
}
