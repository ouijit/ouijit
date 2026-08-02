/**
 * Presentation helpers for pull request state, checks, and reviews.
 *
 * Kept out of the components so the list badge, the detail header, and the
 * kanban card badge all describe the same PR the same way.
 */

import type { ChecksState, PullRequestSummary, ReviewDecision } from '../../github/types';
import { formatRelativeTime } from '../../utils/formatDate';

/** GitHub timestamps arrive as ISO strings; the shared formatter takes a Date. */
export function since(isoTimestamp: string): string {
  return formatRelativeTime(new Date(isoTimestamp));
}

export interface StateBadge {
  label: string;
  icon: string;
  className: string;
}

export function stateBadge(pr: Pick<PullRequestSummary, 'state' | 'isDraft'>): StateBadge {
  if (pr.state === 'merged') {
    return { label: 'Merged', icon: 'git-merge', className: 'bg-vcs-renamed/15 text-vcs-renamed' };
  }
  if (pr.state === 'closed') {
    return { label: 'Closed', icon: 'x-circle', className: 'bg-vcs-deleted/15 text-vcs-deleted' };
  }
  if (pr.isDraft) {
    return { label: 'Draft', icon: 'git-pull-request', className: 'bg-ink/[0.08] text-ink/50' };
  }
  return { label: 'Open', icon: 'git-pull-request', className: 'bg-vcs-added/15 text-vcs-added' };
}

export function checksBadge(state: ChecksState): { icon: string; className: string; label: string } | null {
  switch (state) {
    case 'success':
      return { icon: 'check-circle', className: 'text-vcs-added', label: 'Checks passing' };
    case 'failure':
      return { icon: 'x-circle', className: 'text-vcs-deleted', label: 'Checks failing' };
    case 'pending':
      return { icon: 'clock', className: 'text-vcs-modified', label: 'Checks running' };
    default:
      return null;
  }
}

export function reviewDecisionLabel(decision: ReviewDecision): { label: string; className: string } | null {
  switch (decision) {
    case 'APPROVED':
      return { label: 'Approved', className: 'text-vcs-added' };
    case 'CHANGES_REQUESTED':
      return { label: 'Changes requested', className: 'text-vcs-deleted' };
    case 'REVIEW_REQUIRED':
      return { label: 'Review required', className: 'text-ink/40' };
    default:
      return null;
  }
}

/** Icon + color for one entry in the checks list. */
export function checkRunAppearance(
  conclusion: string | null,
  status: string | null,
): { icon: string; className: string } {
  if (status && status !== 'COMPLETED') return { icon: 'clock', className: 'text-vcs-modified' };
  switch (conclusion) {
    case 'SUCCESS':
      return { icon: 'check-circle', className: 'text-vcs-added' };
    case 'FAILURE':
    case 'ERROR':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
      return { icon: 'x-circle', className: 'text-vcs-deleted' };
    case 'CANCELLED':
    case 'SKIPPED':
    case 'NEUTRAL':
      return { icon: 'minus-circle', className: 'text-ink/35' };
    case 'PENDING':
    case 'EXPECTED':
      return { icon: 'clock', className: 'text-vcs-modified' };
    default:
      return { icon: 'circle', className: 'text-ink/35' };
  }
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

/** GitHub label colors are bare hex without the leading #. */
export function labelStyle(color: string): { background: string; color: string } {
  const hex = color.startsWith('#') ? color : `#${color}`;
  return {
    background: `color-mix(in srgb, ${hex} 18%, transparent)`,
    color: `color-mix(in srgb, ${hex} 75%, var(--color-ink))`,
  };
}
