/**
 * GraphQL documents. Every one takes its arguments as declared variables:
 * nothing is interpolated, so a branch or repo name containing a quote cannot
 * break the document.
 */

/** Fields every PR row in the inbox needs. */
const PR_SUMMARY_FIELDS = `
  number
  title
  state
  isDraft
  url
  createdAt
  updatedAt
  additions
  deletions
  changedFiles
  reviewDecision
  headRefName
  baseRefName
  author { login avatarUrl }
  comments { totalCount }
  labels(first: 10) { nodes { name color } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
`;

/**
 * The inbox, in one round trip. The `reviewRequested` search runs alongside the
 * plain list because a review request can land on a team: `reviewRequests` on
 * the PR names the team without saying whether the viewer is in it.
 */
export const PULL_REQUEST_LIST_QUERY = `
query($owner: String!, $repo: String!, $first: Int!, $reviewQuery: String!) {
  viewer { login avatarUrl }
  repository(owner: $owner, name: $repo) {
    pullRequests(first: $first, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${PR_SUMMARY_FIELDS} }
    }
  }
  reviewRequested: search(query: $reviewQuery, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { number } }
  }
}`;

/**
 * Everything the PR detail view renders, in one document: each `gh` call is a
 * fork, and the rate limit is shared with every other tool using the token.
 */
export const PULL_REQUEST_DETAIL_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  viewer { login avatarUrl }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${PR_SUMMARY_FIELDS}
      body
      headRefOid
      baseRefOid
      mergeable
      mergeStateStatus
      viewerCanUpdate
      viewerCanMergeAsAdmin
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          diffSide
          # A comment has no side of its own — the side belongs to the thread
          # it hangs off, and PullRequestReviewComment has no diffSide field.
          comments(first: 50) {
            nodes {
              id
              databaseId
              body
              createdAt
              url
              line
              originalLine
              viewerCanDelete
              author { login avatarUrl }
            }
          }
        }
      }
      timelineItems(
        last: 60
        itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT, READY_FOR_REVIEW_EVENT]
      ) {
        nodes {
          __typename
          ... on IssueComment { id databaseId body createdAt url viewerCanDelete author { login avatarUrl } }
          ... on PullRequestReview { id body state createdAt url author { login avatarUrl } }
          ... on MergedEvent { id createdAt url actor { login avatarUrl } }
          ... on ClosedEvent { id createdAt actor { login avatarUrl } }
          ... on ReopenedEvent { id createdAt actor { login avatarUrl } }
          ... on ReadyForReviewEvent { id createdAt actor { login avatarUrl } }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name conclusion status detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/** Fields every issue needs, whether it is a row in the list or the open one. */
const ISSUE_FIELDS = `
  number
  title
  body
  state
  stateReason
  url
  createdAt
  updatedAt
  author { login avatarUrl }
  comments { totalCount }
  labels(first: 10) { nodes { name color } }
  assignees(first: 10) { nodes { login } }
`;

export const ISSUE_LIST_QUERY = `
query($owner: String!, $repo: String!, $first: Int!) {
  viewer { login avatarUrl }
  repository(owner: $owner, name: $repo) {
    issues(first: $first, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
}`;

/**
 * One issue and its thread, fetched by number so a closed issue or one past the
 * list's limit is still readable and convertible to a task.
 */
export const ISSUE_DETAIL_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  viewer { login avatarUrl }
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      ${ISSUE_FIELDS}
      timelineItems(last: 60, itemTypes: [ISSUE_COMMENT, CLOSED_EVENT, REOPENED_EVENT]) {
        nodes {
          __typename
          ... on IssueComment { id databaseId body createdAt url viewerCanDelete author { login avatarUrl } }
          ... on ClosedEvent { id createdAt actor { login avatarUrl } }
          ... on ReopenedEvent { id createdAt actor { login avatarUrl } }
        }
      }
    }
  }
}`;

export const RESOLVE_THREAD_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;

export const UNRESOLVE_THREAD_MUTATION = `
mutation($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;

/**
 * Whether what is on screen is still current, in four fields, asked on hover.
 * `updatedAt` moves for a comment or review as well as a push, so the pair says
 * both whether anything is new and whether it is code.
 */
export const PULL_REQUEST_FRESHNESS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      headRefOid
      updatedAt
      state
      isDraft
    }
  }
}`;
