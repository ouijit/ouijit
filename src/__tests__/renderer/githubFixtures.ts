import type { GithubIssue, IssueDetail, PullRequestDetail, PullRequestSummary, TaskWithWorkspace } from '../../types';
import type { GithubIssueList, InboxResult, PullRequestFile } from '../../github/types';

/** What the GitHub panel is handed, filled in enough to render. */

export function pr(over: Partial<PullRequestSummary> & { number: number }): PullRequestSummary {
  return {
    title: `PR ${over.number}`,
    state: 'open',
    isDraft: false,
    author: 'someone',
    headRefName: `feat-${over.number}`,
    baseRefName: 'main',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    url: `https://github.com/o/r/pull/${over.number}`,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    commentCount: 0,
    reviewDecision: null,
    checksState: 'none',
    labels: [],
    isMine: false,
    reviewRequested: false,
    ...over,
  };
}

/** One changed file, filled in enough for the rail and the document to draw it. */
export function changed(path: string, over: Partial<PullRequestFile> = {}): PullRequestFile {
  return { path, status: 'M', additions: 1, deletions: 1, ...over };
}

export function inbox(over: Partial<InboxResult> = {}): InboxResult {
  return { viewer: 'me', needsReview: [], mine: [], others: [], draftCounts: {}, linkedTasks: {}, ...over };
}

export function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ...pr({ number: 5 }),
    body: 'why this change exists',
    baseSha: 'aaa',
    headSha: 'bbb',
    threads: [],
    timeline: [],
    checks: [],
    merge: { mergeable: 'MERGEABLE', stateStatus: 'CLEAN', blockers: [], hardBlock: null, canBypass: false },
    ...over,
  };
}

export function issue(over: Partial<GithubIssue> & { number: number }): GithubIssue {
  return {
    title: `Issue ${over.number}`,
    body: 'what is wrong',
    state: 'open',
    stateReason: null,
    author: 'someone',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    url: `https://github.com/o/r/issues/${over.number}`,
    labels: [],
    assignees: [],
    commentCount: 0,
    ...over,
  };
}

/** The Issues tab's GitHub half. Anything not named is the repo's open list. */
export function issueList(over: Partial<GithubIssueList> = {}): GithubIssueList {
  return { assigned: [], open: [], assignedCapped: false, openCapped: false, ...over };
}

export function issueDetail(over: Partial<IssueDetail> & { number: number }): IssueDetail {
  return { ...issue(over), timeline: [], viewer: 'me', ...over };
}

export function task(over: Partial<TaskWithWorkspace> & { taskNumber: number }): TaskWithWorkspace {
  return {
    name: `Task ${over.taskNumber}`,
    status: 'todo',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}
