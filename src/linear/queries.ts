/**
 * The GraphQL documents.
 *
 * Written out rather than assembled from the SDK's models: a model resolves its
 * relations lazily, so reading an assignee off each row of a list is another
 * request per row against a shared rate limit. Everything a row or a detail
 * needs is selected up front here instead.
 */

const USER_FIELDS = `id name displayName avatarUrl`;

const STATE_FIELDS = `id name type color`;

/** Everything a row of the Issues list draws, and the detail starts from. */
export const ISSUE_FIELDS = `
  id
  identifier
  title
  url
  createdAt
  updatedAt
  priority
  priorityLabel
  estimate
  branchName
  state { ${STATE_FIELDS} }
  team { id key name }
  assignee { ${USER_FIELDS} }
  creator { ${USER_FIELDS} }
  cycle { id number name }
`;

export const VIEWER_QUERY = `
query {
  viewer { ${USER_FIELDS} }
  organization { id name }
}`;

/**
 * The teams the key can see, and the children of the workspace label group
 * named `repo` — the convention other Linear integrations already write, whose
 * children are named `owner/repo`.
 */
export const SCOPE_OPTIONS_QUERY = `
query {
  teams(first: 100) {
    nodes { id key name triageEnabled }
  }
  issueLabels(first: 250, filter: { parent: { name: { eq: "repo" } } }) {
    nodes { id name }
  }
}`;

/**
 * All four groups in one document, each under the project's scope filter.
 *
 * Ordered by `sort` rather than `orderBy`: the latter's direction is Linear's
 * to choose, and every group here means "most recently touched first".
 *
 * Ordering matters: a group excludes what the groups above it hold, and that
 * exclusion is applied to the mapped result rather than in the filters, since
 * "not in the list I have not fetched yet" is not something GraphQL can say.
 */
export const ISSUE_GROUPS_QUERY = `
query($scope: IssueFilter!, $first: Int!) {
  viewer { ${USER_FIELDS} }
  triage: issues(
    first: $first
    sort: [{ updatedAt: { order: Descending } }]
    filter: { and: [$scope, { state: { type: { eq: "triage" } } }] }
  ) { nodes { ${ISSUE_FIELDS} } }

  started: issues(
    first: $first
    sort: [{ updatedAt: { order: Descending } }]
    filter: { and: [$scope, { assignee: { isMe: { eq: true } } }, { state: { type: { eq: "started" } } }] }
  ) { nodes { ${ISSUE_FIELDS} } }

  assigned: issues(
    first: $first
    sort: [{ updatedAt: { order: Descending } }]
    filter: {
      and: [$scope, { assignee: { isMe: { eq: true } } }, { state: { type: { in: ["backlog", "unstarted"] } } }]
    }
  ) { nodes { ${ISSUE_FIELDS} } }

  cycle: issues(
    first: $first
    sort: [{ updatedAt: { order: Descending } }]
    filter: {
      and: [
        $scope
        { cycle: { isActive: { eq: true } } }
        { state: { type: { in: ["backlog", "unstarted", "started"] } } }
      ]
    }
  ) { nodes { ${ISSUE_FIELDS} } }
}`;

/**
 * What Current cycle falls back to where no cycle is active. A second request
 * rather than a fifth field on the document above: it is needed in the minority
 * of workspaces, and every capped-at-50 group with its relations selected is
 * complexity spent against a 10,000-point ceiling.
 */
export const INCOMPLETE_ISSUES_QUERY = `
query($scope: IssueFilter!, $first: Int!) {
  issues(
    first: $first
    sort: [{ updatedAt: { order: Descending } }]
    filter: { and: [$scope, { state: { type: { in: ["backlog", "unstarted", "started"] } } }] }
  ) { nodes { ${ISSUE_FIELDS} } }
}`;

/**
 * One issue with its comments and its team's workflow states. Fetched by
 * identifier so an issue outside every group's page is still readable.
 */
export const ISSUE_DETAIL_QUERY = `
query($id: String!) {
  viewer { ${USER_FIELDS} }
  issue(id: $id) {
    ${ISSUE_FIELDS}
    description
    labels(first: 20) { nodes { id name color } }
    comments(first: 60) {
      nodes { id body createdAt url user { ${USER_FIELDS} } }
    }
    team {
      id
      key
      name
      states(first: 50) { nodes { ${STATE_FIELDS} position } }
    }
  }
}`;

export const CREATE_COMMENT_MUTATION = `
mutation($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
  }
}`;

export const SET_STATE_MUTATION = `
mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { id state { ${STATE_FIELDS} } }
  }
}`;
