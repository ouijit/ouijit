/**
 * GitHub domain types shared by the main process, the IPC contract, and the
 * renderer.
 *
 * Leaf module at runtime: type-only imports and nothing else, so both sides of
 * the process boundary can depend on it without dragging main-process code into
 * the renderer bundle. `import type` is erased and adds no edge to the module
 * graph — what must never appear here is a value import.
 *
 * What a service returns belongs here too, not beside the function computing
 * it. There the renderer's contract and one function's return type are the same
 * declaration, and a field added to the latter silently changes the former.
 */

import type { BlobContent } from '../git';
import type { TaskWithWorkspace } from '../types';

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

/**
 * What GitHub has for a pull request right now, without fetching the rest of
 * it. Compared against what is on screen to answer whether a refresh would
 * bring anything back.
 */
export interface PullRequestFreshness {
  headSha: string;
  updatedAt: string;
  state: string;
  isDraft: boolean;
}

export interface ReviewComment {
  /** GraphQL node id — needed for replies and resolution. */
  id: string;
  /** REST id, used for `in_reply_to` and for deletion. */
  databaseId: number | null;
  /** GitHub's own answer on whether this viewer may delete it. */
  viewerCanDelete: boolean;
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
  /** REST id of a comment, which is what deleting one takes. */
  databaseId?: number | null;
  /** GitHub's own answer on whether this viewer may delete it. */
  viewerCanDelete?: boolean;
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
  /**
   * Who fetched this, and their avatar. `isMine` is already derived from the
   * same field, and carrying it lets a comment box show you your own face
   * without waiting on a separate inbox fetch to say who you are.
   */
  viewer: string;
  viewerAvatarUrl?: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  /** Why a closed issue was closed: COMPLETED, NOT_PLANNED, or null. */
  stateReason: string | null;
  author: string;
  authorAvatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: PullRequestLabel[];
  assignees: string[];
  /** Assigned to the authenticated user. */
  isMine: boolean;
  commentCount: number;
}

/**
 * One issue, with everything said about it.
 *
 * Same shape as a pull request detail minus the code, since the panel renders
 * the two through the same chrome.
 */
export interface IssueDetail extends GithubIssue {
  timeline: TimelineItem[];
  /** Who fetched this, so a comment box can show their face without the inbox. */
  viewer: string;
  viewerAvatarUrl?: string;
}

/** The three groups the inbox renders, computed main-side so both surfaces agree. */
export interface PullRequestInbox {
  viewer: string;
  viewerAvatarUrl?: string;
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
  /** The first line. Equal to `line` where the comment is on one. */
  startLine: number;
  /**
   * True when the pull request's head has moved past this comment and its
   * snippet was nowhere in the new diff.
   *
   * GitHub rejects a whole review if one comment anchors outside the diff, so a
   * draft in this state takes every other one down with it if sent.
   */
  unplaceable?: boolean;
  body: string;
  createdAt: string;
  /** 'human' when typed here; the caller's name when written by the CLI. */
  origin: string;
  /** GraphQL thread id when this draft is a reply rather than a new thread. */
  replyToThreadId?: string;
  /** REST comment id the reply hangs off (GitHub needs the numeric id). */
  replyToCommentId?: number;
}

/**
 * Which endpoint deletes a comment. A conversation comment lives on the issue
 * thread; one anchored to a line lives on the pull request's review comments.
 */
export type CommentKind = 'issue' | 'review';

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export type MergeMethod = 'merge' | 'squash' | 'rebase';

/**
 * What `github:drafts-changed` carries.
 *
 * The only push in the GitHub surface. A draft written by the CLI happens in
 * another process, so the renderer cannot know without being told; everything
 * else refreshes because someone pressed something. Its handler does one local
 * read and never touches the network — keep it that way.
 */
export interface GithubDraftsChangedPayload {
  projectPath: string;
  prNumber: number;
}

// ── What the service hands back ──────────────────────────────────────

export interface InboxResult extends PullRequestInbox {
  /** Draft counts per PR so the list can badge unsubmitted work. */
  draftCounts: Record<number, number>;
  /**
   * PR number → task number, including the links this fetch itself made. For
   * callers with no task state of their own to join against, and for those that
   * have it to notice theirs is a link behind.
   */
  linkedTasks: Record<number, number>;
}

export interface PullRequestFilesResult {
  files: PullRequestFile[];
  /** True when the file list came from git because the API list was unusable. */
  fromGit: boolean;
  error?: string;
}

/** The revisions a pull request's diff is read between, and its drafts anchored in. */
export interface PrHead {
  baseSha: string;
  headSha: string;
}

export interface SaveDraftInput {
  id?: string;
  prNumber: number;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  /** The lines commented on, and the head they were read at. Both ignored on an edit. */
  snippet?: string | null;
  headSha?: string | null;
  body: string;
  replyToThreadId?: string;
  replyToCommentId?: number;
  /** Defaults to 'human'. The renderer never sets it; the CLI and REST do. */
  origin?: string;
}

export interface TaskFromGithubResult {
  success: boolean;
  error?: string;
  task?: TaskWithWorkspace;
  taskNumber?: number;
}

export interface PromoteToTaskResult extends TaskFromGithubResult {
  /** Base branch the task's worktree should merge back into. */
  mergeTarget?: string;
  headRef?: string;
}

export interface SubmitReviewResult {
  success: boolean;
  error?: string;
  url?: string;
}

/** Both sides of a binary file, so an image can be shown before and after. */
export interface PrFileVersions {
  /** The file as of the base. Null when the pull request adds it. */
  before: BlobContent | null;
  /** The file as of the head. Null when the pull request deletes it. */
  after: BlobContent | null;
}
