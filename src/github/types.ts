/**
 * GitHub domain types shared by the main process, the IPC contract, and the
 * renderer.
 *
 * Leaf module: no imports, so both sides of the process boundary can depend on
 * it without dragging main-process code into the renderer bundle.
 */

/** A repo resolved from a git remote URL. `host` is 'github.com' or a GHES host. */
export interface RepoIdentity {
  host: string;
  owner: string;
  repo: string;
}

/** `owner/repo`, the form `gh --repo` takes. */
export function repoSlug(identity: RepoIdentity): string {
  return `${identity.owner}/${identity.repo}`;
}

/** Why the GitHub surface is unavailable for a project. */
export type GithubUnavailableReason =
  | 'flag-off'
  | 'gh-missing'
  | 'gh-unauthenticated'
  | 'no-remote'
  | 'not-github'
  | 'gh-too-old';

export interface GithubAvailability {
  available: boolean;
  reason?: GithubUnavailableReason;
  /** Human-readable explanation, shown instead of a blank panel. */
  message?: string;
  identity?: RepoIdentity;
  /** Login of the authenticated user, when we got that far. */
  viewer?: string;
}

export type PullRequestState = 'open' | 'closed' | 'merged';

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

/** Rolled-up commit status for the PR head. */
export type ChecksState = 'success' | 'failure' | 'pending' | 'none';

export interface PullRequestSummary {
  number: number;
  title: string;
  state: PullRequestState;
  isDraft: boolean;
  author: string;
  authorAvatarUrl?: string;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commentCount: number;
  reviewDecision: ReviewDecision;
  checksState: ChecksState;
  labels: PullRequestLabel[];
  /** Authored by the authenticated user. */
  isMine: boolean;
  /** The authenticated user (or one of their teams) is a requested reviewer. */
  reviewRequested: boolean;
}

export interface PullRequestLabel {
  name: string;
  color: string;
}

export interface PullRequestFile {
  path: string;
  /** Mirrors ChangedFile['status'] so the shared diff primitives can render it. */
  status: 'M' | 'A' | 'D' | 'R';
  oldPath?: string;
  additions: number;
  deletions: number;
}

export interface ReviewComment {
  /** GraphQL node id — needed for replies and resolution. */
  id: string;
  /** REST id, used for `in_reply_to`. */
  databaseId: number | null;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url: string;
  /** Line in the current head/base blob; null once the comment goes outdated. */
  line: number | null;
  /** Line the comment was originally left on. Survives head moves. */
  originalLine: number | null;
  side: 'LEFT' | 'RIGHT';
}

export interface ReviewThread {
  id: string;
  path: string;
  /** Anchor line in the current diff, null when the thread is outdated. */
  line: number | null;
  originalLine: number | null;
  side: 'LEFT' | 'RIGHT';
  isResolved: boolean;
  /** The head moved past the lines this thread was left on. */
  isOutdated: boolean;
  comments: ReviewComment[];
}

export type TimelineItemKind = 'comment' | 'review' | 'commit' | 'event';

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url?: string;
  /** For reviews: APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED. */
  reviewState?: string;
  /** For events: 'merged', 'closed', 'reopened', … */
  eventType?: string;
}

export interface CheckRun {
  name: string;
  /** 'SUCCESS' | 'FAILURE' | 'NEUTRAL' | 'CANCELLED' | 'SKIPPED' | 'TIMED_OUT' | 'ACTION_REQUIRED' | null */
  conclusion: string | null;
  /** 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | … */
  status: string | null;
  url?: string;
}

/** Whether a merge is possible, and what stands in the way if not. */
export interface MergeStatus {
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  /** GitHub's mergeStateStatus: CLEAN, BLOCKED, BEHIND, DIRTY, DRAFT, UNSTABLE, … */
  stateStatus: string;
  /** Plain-language blockers, surfaced before the merge button rather than after. */
  blockers: string[];
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string;
  baseSha: string;
  headSha: string;
  merge: MergeStatus;
  threads: ReviewThread[];
  timeline: TimelineItem[];
  checks: CheckRun[];
  /** True when the viewer can push to the head branch (drives the merge button). */
  viewerCanUpdate: boolean;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: PullRequestLabel[];
  /** Assigned to the authenticated user. */
  isMine: boolean;
  commentCount: number;
}

/** The three groups the inbox renders, computed main-side so both surfaces agree. */
export interface PullRequestInbox {
  viewer: string;
  needsReview: PullRequestSummary[];
  mine: PullRequestSummary[];
  others: PullRequestSummary[];
}

/** A locally-stored review comment that has not been submitted to GitHub yet. */
export interface ReviewDraft {
  id: string;
  projectPath: string;
  prNumber: number;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  /** Set for multi-line comments; must be < line and on the same side. */
  startLine?: number;
  body: string;
  createdAt: string;
  /** GraphQL thread id when this draft is a reply rather than a new thread. */
  replyToThreadId?: string;
  /** REST comment id the reply hangs off (GitHub needs the numeric id). */
  replyToCommentId?: number;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export type MergeMethod = 'merge' | 'squash' | 'rebase';

/** What `github:changed` carries so the renderer can refresh selectively. */
export interface GithubChangedPayload {
  projectPath: string;
  /** Bumped every poll that observed different data. */
  ts: number;
}
