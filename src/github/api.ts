/**
 * GitHub reads and writes, mapped onto the app's own domain types.
 *
 * Split of responsibility, per the diff-source decision: the API supplies
 * metadata — the file list with rename statuses, threads, the timeline, checks
 * — and git supplies the bytes. Nothing here fetches a `patch`.
 */

import { ghRest, ghRestVoid, ghGraphql, runGh, GithubError } from './client';
import { MAX_DIFF_FILES } from '../diffSource';
import { repoSlug } from './types';
import {
  PULL_REQUEST_LIST_QUERY,
  PULL_REQUEST_DETAIL_QUERY,
  PULL_REQUEST_FRESHNESS_QUERY,
  ISSUE_LIST_QUERY,
  ISSUE_DETAIL_QUERY,
  RESOLVE_THREAD_MUTATION,
  UNRESOLVE_THREAD_MUTATION,
} from './queries';
import { DEFAULT_GH_HOST } from './repoUrl';
import type {
  RepoIdentity,
  GithubRepoSummary,
  PullRequestSummary,
  PullRequestDetail,
  PullRequestFreshness,
  PullRequestFile,
  PullRequestInbox,
  PullRequestLabel,
  ReviewThread,
  ReviewComment,
  TimelineItem,
  CheckRun,
  ChecksState,
  ReviewDecision,
  MergeStatus,
  GithubIssue,
  IssueDetail,
  CommentKind,
  ReviewEvent,
  MergeOptions,
  PullRequestState,
} from './types';

const PR_LIST_LIMIT = 50;
const ISSUE_LIST_LIMIT = 50;

// ── Raw GraphQL shapes ───────────────────────────────────────────────
// Narrow interfaces for exactly the fields the documents request; everything
// nullable that GitHub can legitimately return as null (a deleted author, a
// PR with no commits, a repo with checks disabled).

interface RawActor {
  login: string;
  avatarUrl?: string;
}

interface RawLabelConnection {
  nodes: Array<{ name: string; color: string } | null> | null;
}

interface RawSummary {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
  headRefName: string;
  baseRefName: string;
  author: RawActor | null;
  comments: { totalCount: number } | null;
  labels: RawLabelConnection | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } } | null> | null } | null;
}

interface RawThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  diffSide: string;
  comments: { nodes: Array<RawReviewComment | null> | null } | null;
}

interface RawReviewComment {
  id: string;
  databaseId: number | null;
  viewerCanDelete: boolean;
  body: string;
  createdAt: string;
  url: string;
  line: number | null;
  originalLine: number | null;
  author: RawActor | null;
}

interface RawTimelineNode {
  __typename: string;
  id: string;
  databaseId?: number | null;
  viewerCanDelete?: boolean;
  body?: string;
  state?: string;
  createdAt: string;
  url?: string;
  author?: RawActor | null;
  actor?: RawActor | null;
}

interface RawCheckContext {
  __typename: string;
  name?: string;
  conclusion?: string | null;
  status?: string | null;
  detailsUrl?: string | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
}

interface RawIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  stateReason: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: RawActor | null;
  comments: { totalCount: number } | null;
  labels: RawLabelConnection | null;
  assignees: { nodes: Array<{ login: string } | null> | null } | null;
}

interface RawDetail extends RawSummary {
  body: string;
  headRefOid: string;
  baseRefOid: string;
  mergeable: string;
  mergeStateStatus: string;
  viewerCanUpdate: boolean;
  viewerCanMergeAsAdmin: boolean;
  reviewThreads: { nodes: Array<RawThread | null> | null } | null;
  timelineItems: { nodes: Array<RawTimelineNode | null> | null } | null;
}

// ── Mapping helpers ──────────────────────────────────────────────────

const GHOST_LOGIN = 'ghost';

function actorLogin(actor: RawActor | null | undefined): string {
  return actor?.login ?? GHOST_LOGIN;
}

function mapLabels(labels: RawLabelConnection | null | undefined): PullRequestLabel[] {
  return (labels?.nodes ?? []).filter((l): l is PullRequestLabel => l != null);
}

/** Draft status rides beside this as `isDraft`, not as one of these values. */
function mapState(state: string): PullRequestState {
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return 'open';
}

/**
 * Fold the commit-status rollup into the four states the list badge shows.
 * A repo with no CI at all reports a null rollup, which is 'none' rather than
 * a pending spinner that never resolves.
 */
function mapChecksState(raw: RawSummary): ChecksState {
  const rollup = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
  if (!rollup) return 'none';
  switch (rollup.state) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failure';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

function mapReviewDecision(raw: string | null): ReviewDecision {
  if (raw === 'APPROVED' || raw === 'CHANGES_REQUESTED' || raw === 'REVIEW_REQUIRED') return raw;
  return null;
}

function mapSummary(raw: RawSummary, viewer: string, reviewRequested: Set<number>): PullRequestSummary {
  const author = actorLogin(raw.author);
  return {
    number: raw.number,
    title: raw.title,
    state: mapState(raw.state),
    isDraft: raw.isDraft,
    author,
    authorAvatarUrl: raw.author?.avatarUrl,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    url: raw.url,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    commentCount: raw.comments?.totalCount ?? 0,
    reviewDecision: mapReviewDecision(raw.reviewDecision),
    checksState: mapChecksState(raw),
    labels: mapLabels(raw.labels),
    isMine: author === viewer,
    reviewRequested: reviewRequested.has(raw.number),
  };
}

function mapIssue(raw: RawIssue, viewer: string): GithubIssue {
  const assignees = (raw.assignees?.nodes ?? []).map((a) => a?.login).filter((l): l is string => l != null);
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    state: raw.state === 'CLOSED' ? 'closed' : 'open',
    stateReason: raw.stateReason,
    author: actorLogin(raw.author),
    authorAvatarUrl: raw.author?.avatarUrl,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    url: raw.url,
    labels: mapLabels(raw.labels),
    assignees,
    isMine: assignees.includes(viewer),
    commentCount: raw.comments?.totalCount ?? 0,
  };
}

function mapSide(raw: string): 'LEFT' | 'RIGHT' {
  return raw === 'LEFT' ? 'LEFT' : 'RIGHT';
}

/**
 * A comment inherits its thread's side. `PullRequestReviewComment` has no
 * `diffSide` of its own — the anchor side is a property of the thread, and
 * every comment in a thread shares it.
 */
function mapComment(raw: RawReviewComment, side: 'LEFT' | 'RIGHT'): ReviewComment {
  return {
    id: raw.id,
    databaseId: raw.databaseId,
    viewerCanDelete: raw.viewerCanDelete,
    author: actorLogin(raw.author),
    authorAvatarUrl: raw.author?.avatarUrl,
    body: raw.body,
    createdAt: raw.createdAt,
    url: raw.url,
    line: raw.line,
    originalLine: raw.originalLine,
    side,
  };
}

function mapThread(raw: RawThread): ReviewThread {
  const side = mapSide(raw.diffSide);
  return {
    id: raw.id,
    path: raw.path,
    line: raw.line,
    originalLine: raw.originalLine,
    side,
    isResolved: raw.isResolved,
    isOutdated: raw.isOutdated,
    comments: (raw.comments?.nodes ?? [])
      .filter((c): c is RawReviewComment => c != null)
      .map((c) => mapComment(c, side)),
  };
}

function mapTimelineItem(raw: RawTimelineNode): TimelineItem | null {
  const base = {
    id: raw.id,
    createdAt: raw.createdAt,
    url: raw.url,
    author: actorLogin(raw.author ?? raw.actor),
    authorAvatarUrl: (raw.author ?? raw.actor)?.avatarUrl,
  };
  switch (raw.__typename) {
    case 'IssueComment':
      return {
        ...base,
        kind: 'comment',
        body: raw.body ?? '',
        databaseId: raw.databaseId ?? null,
        viewerCanDelete: raw.viewerCanDelete ?? false,
      };
    case 'PullRequestReview':
      // A review with no body and no state is only the envelope around inline
      // comments, which the threads panel already renders.
      if (!raw.body && (raw.state === 'COMMENTED' || !raw.state)) return null;
      return { ...base, kind: 'review', body: raw.body ?? '', reviewState: raw.state };
    case 'MergedEvent':
      return { ...base, kind: 'event', body: '', eventType: 'merged' };
    case 'ClosedEvent':
      return { ...base, kind: 'event', body: '', eventType: 'closed' };
    case 'ReopenedEvent':
      return { ...base, kind: 'event', body: '', eventType: 'reopened' };
    case 'ReadyForReviewEvent':
      return { ...base, kind: 'event', body: '', eventType: 'ready for review' };
    default:
      return null;
  }
}

function mapCheckContext(raw: RawCheckContext): CheckRun | null {
  if (raw.__typename === 'CheckRun') {
    return {
      name: raw.name ?? 'check',
      conclusion: raw.conclusion ?? null,
      status: raw.status ?? null,
      url: raw.detailsUrl ?? undefined,
    };
  }
  if (raw.__typename === 'StatusContext') {
    // A commit status has no separate run state; its `state` doubles as the
    // conclusion so the UI can treat both context kinds uniformly.
    return {
      name: raw.context ?? 'status',
      conclusion: raw.state ?? null,
      status: 'COMPLETED',
      url: raw.targetUrl ?? undefined,
    };
  }
  return null;
}

/**
 * Turn GitHub's merge signals into blockers a person can act on. Surfaced
 * above the merge button rather than as a failure after pressing it.
 */
export function deriveMergeStatus(raw: {
  mergeable: string;
  mergeStateStatus: string;
  isDraft: boolean;
  reviewDecision: ReviewDecision;
  checksState: ChecksState;
  viewerCanMergeAsAdmin: boolean;
}): MergeStatus {
  const blockers: string[] = [];
  if (raw.isDraft) blockers.push('Pull request is a draft');
  if (raw.mergeable === 'CONFLICTING') blockers.push('Conflicts must be resolved');
  if (raw.reviewDecision === 'CHANGES_REQUESTED') blockers.push('Changes were requested');
  if (raw.reviewDecision === 'REVIEW_REQUIRED') blockers.push('Review is required');
  if (raw.checksState === 'failure') blockers.push('Checks are failing');
  if (raw.checksState === 'pending') blockers.push('Checks are still running');
  if (raw.mergeStateStatus === 'BEHIND') blockers.push('Branch is behind the base and must be updated');
  if (raw.mergeStateStatus === 'BLOCKED' && blockers.length === 0) {
    blockers.push('Blocked by a branch protection rule');
  }
  const hardBlock = raw.isDraft
    ? 'Mark the pull request ready for review first'
    : raw.mergeable === 'CONFLICTING'
      ? 'Resolve the conflicts first'
      : null;
  return {
    mergeable: raw.mergeable === 'MERGEABLE' || raw.mergeable === 'CONFLICTING' ? raw.mergeable : 'UNKNOWN',
    stateStatus: raw.mergeStateStatus,
    blockers,
    hardBlock,
    canBypass: raw.viewerCanMergeAsAdmin && hardBlock == null && blockers.length > 0,
  };
}

// ── Reads ────────────────────────────────────────────────────────────

/**
 * Open PRs for a repo, split into the three inbox buckets. Split main-side, so
 * the panel and the command palette read the same buckets.
 */
export async function fetchInbox(identity: RepoIdentity): Promise<PullRequestInbox> {
  const data = await ghGraphql<{
    viewer: { login: string; avatarUrl?: string };
    repository: { pullRequests: { nodes: Array<RawSummary | null> | null } } | null;
    reviewRequested: { nodes: Array<{ number?: number } | null> | null };
  }>(
    PULL_REQUEST_LIST_QUERY,
    {
      owner: identity.owner,
      repo: identity.repo,
      first: PR_LIST_LIMIT,
      reviewQuery: `repo:${repoSlug(identity)} is:pr is:open review-requested:@me`,
    },
    { identity },
  );

  if (!data.repository) throw new GithubError('not-found', `Repository ${repoSlug(identity)} not found`);

  const viewer = data.viewer.login;
  const requested = new Set<number>();
  for (const node of data.reviewRequested.nodes ?? []) {
    if (node?.number != null) requested.add(node.number);
  }

  const all = (data.repository.pullRequests.nodes ?? [])
    .filter((n): n is RawSummary => n != null)
    .map((n) => mapSummary(n, viewer, requested));

  // A PR you authored that also lists you as a reviewer belongs under "yours" —
  // otherwise self-requested reviews show up in both buckets.
  const needsReview = all.filter((pr) => pr.reviewRequested && !pr.isMine);
  const mine = all.filter((pr) => pr.isMine);
  const claimed = new Set([...needsReview, ...mine].map((pr) => pr.number));
  const others = all.filter((pr) => !claimed.has(pr.number));

  return { viewer, viewerAvatarUrl: data.viewer.avatarUrl, needsReview, mine, others };
}

/**
 * Whether the pull request on screen is still current. Runs on hover, so it
 * asks for four fields rather than reusing `fetchPullRequest`, whose detail
 * query pulls a hundred threads, a timeline and a check rollup.
 */
export async function fetchPullRequestFreshness(identity: RepoIdentity, number: number): Promise<PullRequestFreshness> {
  const data = await ghGraphql<{
    repository: {
      pullRequest: { headRefOid: string; updatedAt: string; state: string; isDraft: boolean } | null;
    } | null;
  }>(PULL_REQUEST_FRESHNESS_QUERY, { owner: identity.owner, repo: identity.repo, number }, { identity });

  const pr = data.repository?.pullRequest;
  if (!pr) throw new GithubError('not-found', `Pull request #${number} not found`);
  return { headSha: pr.headRefOid, updatedAt: pr.updatedAt, state: pr.state, isDraft: pr.isDraft };
}

export async function fetchPullRequest(identity: RepoIdentity, number: number): Promise<PullRequestDetail> {
  const data = await ghGraphql<{
    viewer: { login: string; avatarUrl?: string };
    repository: {
      pullRequest:
        | (RawDetail & {
            commits: {
              nodes: Array<{
                commit: {
                  statusCheckRollup: {
                    state: string;
                    contexts: { nodes: Array<RawCheckContext | null> | null };
                  } | null;
                };
              } | null> | null;
            } | null;
          })
        | null;
    } | null;
  }>(PULL_REQUEST_DETAIL_QUERY, { owner: identity.owner, repo: identity.repo, number }, { identity });

  const pr = data.repository?.pullRequest;
  if (!pr) throw new GithubError('not-found', `Pull request #${number} not found`);

  const summary = mapSummary(pr, data.viewer.login, new Set());
  const rollupContexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];

  return {
    ...summary,
    body: pr.body ?? '',
    baseSha: pr.baseRefOid,
    headSha: pr.headRefOid,
    viewerCanUpdate: pr.viewerCanUpdate,
    viewer: data.viewer.login,
    viewerAvatarUrl: data.viewer.avatarUrl,
    merge: deriveMergeStatus({
      mergeable: pr.mergeable,
      mergeStateStatus: pr.mergeStateStatus,
      isDraft: pr.isDraft,
      reviewDecision: summary.reviewDecision,
      checksState: summary.checksState,
      viewerCanMergeAsAdmin: pr.viewerCanMergeAsAdmin,
    }),
    threads: (pr.reviewThreads?.nodes ?? []).filter((t): t is RawThread => t != null).map(mapThread),
    timeline: (pr.timelineItems?.nodes ?? [])
      .filter((t): t is RawTimelineNode => t != null)
      .map(mapTimelineItem)
      .filter((t): t is TimelineItem => t != null),
    checks: rollupContexts
      .filter((c): c is RawCheckContext => c != null)
      .map(mapCheckContext)
      .filter((c): c is CheckRun => c != null),
  };
}

interface RestFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
}

/**
 * The changed-file list, with rename statuses git alone won't reliably give us
 * (GitHub's rename detection and the local `-M` heuristic can disagree). The
 * diff bytes for each of these come from git, not from here.
 */
export async function fetchPullRequestFiles(identity: RepoIdentity, number: number): Promise<PullRequestFile[]> {
  const raw = await ghRest<RestFile[]>(`repos/${repoSlug(identity)}/pulls/${number}/files?per_page=100`, {
    paginate: true,
    identity,
  });
  return raw.slice(0, MAX_DIFF_FILES).map(mapRestFile);
}

function mapRestFile(file: RestFile): PullRequestFile {
  const status: PullRequestFile['status'] =
    file.status === 'added'
      ? 'A'
      : file.status === 'removed'
        ? 'D'
        : file.status === 'renamed' || file.status === 'copied'
          ? 'R'
          : 'M';
  return {
    path: file.filename,
    status,
    ...(file.previous_filename ? { oldPath: file.previous_filename } : {}),
    additions: file.additions,
    deletions: file.deletions,
  };
}

export async function fetchIssues(identity: RepoIdentity): Promise<GithubIssue[]> {
  const data = await ghGraphql<{
    viewer: { login: string };
    repository: { issues: { nodes: Array<RawIssue | null> | null } } | null;
  }>(ISSUE_LIST_QUERY, { owner: identity.owner, repo: identity.repo, first: ISSUE_LIST_LIMIT }, { identity });

  if (!data.repository) throw new GithubError('not-found', `Repository ${repoSlug(identity)} not found`);

  return (data.repository.issues.nodes ?? [])
    .filter((n): n is RawIssue => n != null)
    .map((n) => mapIssue(n, data.viewer.login));
}

/**
 * One issue by number, with its thread. Not looked up in the list, which holds
 * open issues only and is capped, so anything closed or past the limit would be
 * unreachable.
 */
export async function fetchIssue(identity: RepoIdentity, number: number): Promise<IssueDetail> {
  const data = await ghGraphql<{
    viewer: { login: string; avatarUrl?: string };
    repository: {
      issue: (RawIssue & { timelineItems: { nodes: Array<RawTimelineNode | null> | null } | null }) | null;
    } | null;
  }>(ISSUE_DETAIL_QUERY, { owner: identity.owner, repo: identity.repo, number }, { identity });

  const issue = data.repository?.issue;
  if (!issue) throw new GithubError('not-found', `Issue #${number} not found`);

  return {
    ...mapIssue(issue, data.viewer.login),
    viewer: data.viewer.login,
    viewerAvatarUrl: data.viewer.avatarUrl,
    timeline: (issue.timelineItems?.nodes ?? [])
      .filter((t): t is RawTimelineNode => t != null)
      .map(mapTimelineItem)
      .filter((t): t is TimelineItem => t != null),
  };
}

/**
 * A pull request from a fork can carry the same head branch name as a local
 * one, so cross-repository rows are dropped here rather than by each caller.
 */
async function listPrs<T>(
  identity: RepoIdentity,
  filters: string[],
  fields: Array<keyof T & string>,
  cwd?: string,
): Promise<T[]> {
  try {
    const raw = await runGh(
      ['pr', 'list', '--repo', repoSlug(identity), ...filters, '--json', [...fields, 'isCrossRepository'].join(',')],
      { identity, cwd },
    );
    const parsed: unknown = JSON.parse(raw.trim() || '[]');
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<T & { isCrossRepository: boolean }>).filter((pr) => !pr.isCrossRepository);
  } catch {
    return [];
  }
}

export async function findPullRequestForBranch(
  identity: RepoIdentity,
  branch: string,
  cwd?: string,
): Promise<number | null> {
  const prs = await listPrs<{ number: number; state: string }>(
    identity,
    // More than one, so the open-over-closed preference below has something to
    // choose between on a branch whose old pull request was merged.
    ['--head', branch, '--state', 'all', '--limit', '10'],
    ['number', 'state'],
    cwd,
  );
  // Prefer an open PR; a stale closed one for the same branch shouldn't get
  // linked to a task that is being worked on again.
  const open = prs.find((p) => p.state === 'OPEN');
  return (open ?? prs[0])?.number ?? null;
}

type PullRequestBranch = Pick<PullRequestSummary, 'number' | 'headRefName'>;

export async function fetchOpenPullRequestBranches(identity: RepoIdentity, cwd?: string): Promise<PullRequestBranch[]> {
  return listPrs<PullRequestBranch>(
    identity,
    ['--state', 'open', '--limit', String(PR_LIST_LIMIT)],
    ['number', 'headRefName'],
    cwd,
  );
}

// ── Writes ───────────────────────────────────────────────────────────

export interface DraftReviewComment {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
  body: string;
}

/**
 * Submits a review as one `POST /pulls/{n}/reviews` rather than a call per
 * draft: it is atomic, and it avoids the secondary rate limiting GitHub applies
 * to rapid comment writes.
 *
 * Anchors are `line` + `side`, file line numbers in the head or base blob,
 * which the local `base...head` diff already produces. The older `position`
 * field is a diff offset and is not sent.
 */
export async function submitReview(
  identity: RepoIdentity,
  number: number,
  event: ReviewEvent,
  body: string,
  comments: DraftReviewComment[],
): Promise<{ id: number; url: string }> {
  const payload: Record<string, unknown> = { event };
  if (body.trim()) payload.body = body;
  if (comments.length > 0) payload.comments = comments;

  const response = await ghRest<{ id: number; html_url: string }>(
    `repos/${repoSlug(identity)}/pulls/${number}/reviews`,
    { method: 'POST', body: payload, identity },
  );
  return { id: response.id, url: response.html_url };
}

export async function replyToReviewComment(
  identity: RepoIdentity,
  number: number,
  commentId: number,
  body: string,
): Promise<void> {
  await ghRest(`repos/${repoSlug(identity)}/pulls/${number}/comments/${commentId}/replies`, {
    method: 'POST',
    body: { body },
    identity,
  });
}

/** A top-level conversation comment (the PR's issue thread, not a review thread). */
export async function addIssueComment(identity: RepoIdentity, number: number, body: string): Promise<void> {
  await ghRest(`repos/${repoSlug(identity)}/issues/${number}/comments`, {
    method: 'POST',
    body: { body },
    identity,
  });
}

/**
 * Two endpoints: a conversation comment belongs to the issue thread, and a
 * line-anchored one to the pull request's review comments. GitHub does not
 * accept either id at the other's path.
 */
export async function deleteComment(identity: RepoIdentity, kind: CommentKind, commentId: number): Promise<void> {
  const path = kind === 'review' ? 'pulls/comments' : 'issues/comments';
  await ghRestVoid(`repos/${repoSlug(identity)}/${path}/${commentId}`, { method: 'DELETE', identity });
}

export async function setThreadResolved(identity: RepoIdentity, threadId: string, resolved: boolean): Promise<void> {
  await ghGraphql(resolved ? RESOLVE_THREAD_MUTATION : UNRESOLVE_THREAD_MUTATION, { threadId }, { identity });
}

export interface CreatePullRequestOptions {
  title: string;
  body?: string;
  base?: string;
  head: string;
  draft?: boolean;
}

/**
 * Through `gh pr create` rather than `POST /pulls`: gh applies the repo's pull
 * request template and expands closing keywords (`Fixes #123`) as GitHub's own
 * UI does.
 */
export async function createPullRequest(
  identity: RepoIdentity,
  cwd: string,
  options: CreatePullRequestOptions,
): Promise<{ url: string; number: number | null }> {
  const args = [
    'pr',
    'create',
    '--repo',
    repoSlug(identity),
    '--head',
    options.head,
    '--title',
    options.title,
    '--body',
    options.body ?? '',
  ];
  if (options.base) args.push('--base', options.base);
  if (options.draft) args.push('--draft');

  const stdout = await runGh(args, { identity, cwd });
  const url = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  const match = /\/pull\/(\d+)\s*$/.exec(url);
  return { url, number: match ? parseInt(match[1], 10) : null };
}

export async function mergePullRequest(
  identity: RepoIdentity,
  number: number,
  options: MergeOptions & { cwd?: string },
): Promise<void> {
  await runGh(mergeArgs(identity, number, options), { identity, cwd: options.cwd });
}

export function mergeArgs(identity: RepoIdentity, number: number, options: MergeOptions): string[] {
  const args = ['pr', 'merge', String(number), '--repo', repoSlug(identity), `--${options.method}`];
  if (options.deleteBranch) args.push('--delete-branch');
  // gh's name for the bypass GitHub offers admins on a protected branch.
  if (options.bypass) args.push('--admin');
  return args;
}

/** No pagination: one page of the most recently pushed is what an import is looking for. */
const USER_REPO_LIMIT = 100;

interface RawRepo {
  full_name: string;
  description: string | null;
  private: boolean;
}

/**
 * `full_name` is `owner/name` with no host, so the host has to come from
 * whichever one the request was answered by.
 */
function toRepoSummary(raw: RawRepo, host: string): GithubRepoSummary {
  const [owner, repo] = raw.full_name.split('/');
  return {
    identity: { host, owner, repo },
    description: raw.description,
    isPrivate: raw.private,
  };
}

/** Repos the signed-in user can clone, most recently pushed first. */
export async function fetchUserRepos(): Promise<GithubRepoSummary[]> {
  const raw = await ghRest<RawRepo[]>(
    `user/repos?per_page=${USER_REPO_LIMIT}&sort=pushed&affiliation=owner,collaborator,organization_member`,
  );
  return raw.map((repo) => toRepoSummary(repo, DEFAULT_GH_HOST));
}

/** One repo by identity — the existence check the import dialog runs. */
export async function fetchRepo(identity: RepoIdentity): Promise<GithubRepoSummary> {
  return toRepoSummary(await ghRest<RawRepo>(`repos/${repoSlug(identity)}`, { identity }), identity.host);
}
