/**
 * Linear's API, mapped onto our own types.
 *
 * SDK models cannot cross IPC — they are class instances, and structured clone
 * drops their methods — so everything is a plain object by the time it leaves
 * here. That is also what keeps `types.ts` a runtime leaf.
 */

import { LinearError, createLinearRequest, type FetchLike } from './client';
import {
  CREATE_COMMENT_MUTATION,
  INCOMPLETE_ISSUES_QUERY,
  ISSUE_DETAIL_QUERY,
  ISSUE_GROUPS_QUERY,
  SCOPE_OPTIONS_QUERY,
  SET_STATE_MUTATION,
} from './queries';
import { scopeFilter } from './scope';
import type {
  LinearIssueDetail,
  LinearIssueGroups,
  LinearIssueSummary,
  LinearRepoLabel,
  LinearScope,
  LinearTeam,
  LinearUser,
  LinearWorkflowState,
} from './types';
import type { TimelineItem } from '../issues/types';

/** The same 50 the GitHub lists take. */
export const GROUP_LIMIT = 50;

// ── Raw shapes, as the documents select them ─────────────────────────

interface RawUser {
  id: string;
  name: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface RawState {
  id: string;
  name: string;
  type: string;
  color: string;
  position?: number;
}

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  priority: number;
  priorityLabel: string;
  estimate?: number | null;
  branchName: string;
  state: RawState;
  team: { id: string; key: string; name: string };
  assignee?: RawUser | null;
  creator?: RawUser | null;
  cycle?: { id: string; number: number; name?: string | null } | null;
}

interface RawComment {
  id: string;
  body: string;
  createdAt: string;
  url: string;
  user?: RawUser | null;
}

type Nodes<T> = { nodes: Array<T | null> | null } | null;

function list<T>(connection: Nodes<T>): T[] {
  return (connection?.nodes ?? []).filter((node): node is T => node != null);
}

// ── Reads ────────────────────────────────────────────────────────────

/** The teams and `repo` labels the connect row offers. */
export async function fetchScopeOptions(
  apiKey: string,
  fetchImpl?: FetchLike,
): Promise<{ teams: LinearTeam[]; repoLabels: LinearRepoLabel[] }> {
  const request = createLinearRequest(apiKey, fetchImpl);
  const data = await request<{
    teams: Nodes<{ id: string; key: string; name: string; triageEnabled: boolean }>;
    issueLabels: Nodes<{ id: string; name: string }>;
  }>(SCOPE_OPTIONS_QUERY);

  return {
    teams: list(data.teams).map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
      triageEnabled: team.triageEnabled,
    })),
    repoLabels: list(data.issueLabels).map((label) => ({ id: label.id, name: label.name })),
  };
}

/**
 * All four groups of the Issues list, under one scope.
 *
 * Exclusivity is applied here rather than in the filters: an issue belongs to
 * the first group that claims it, and "not in a list I have not fetched yet" is
 * not something a GraphQL filter can say.
 */
export async function fetchIssueGroups(
  apiKey: string,
  scope: LinearScope,
  teams: LinearTeam[],
  fetchImpl?: FetchLike,
): Promise<LinearIssueGroups> {
  const request = createLinearRequest(apiKey, fetchImpl);
  const filter = scopeFilter(scope);
  const data = await request<{
    triage: Nodes<RawIssue>;
    started: Nodes<RawIssue>;
    assigned: Nodes<RawIssue>;
    cycle: Nodes<RawIssue>;
  }>(ISSUE_GROUPS_QUERY, { scope: filter, first: GROUP_LIMIT });

  const triage = list(data.triage).map(mapIssue);
  const started = list(data.started).map(mapIssue);
  const assigned = list(data.assigned).map(mapIssue);
  let cycle = list(data.cycle).map(mapIssue);
  let cycleIsFallback = false;

  if (cycle.length === 0) {
    const fallback = await request<{ issues: Nodes<RawIssue> }>(INCOMPLETE_ISSUES_QUERY, {
      scope: filter,
      first: GROUP_LIMIT,
    });
    cycle = list(fallback.issues).map(mapIssue);
    cycleIsFallback = true;
  }

  const claimed = new Set<string>();
  const take = (issues: LinearIssueSummary[]) => {
    const kept = issues.filter((issue) => !claimed.has(issue.id));
    for (const issue of kept) claimed.add(issue.id);
    return kept;
  };

  return {
    triage: take(triage),
    started: take(started),
    assigned: take(assigned),
    cycle: take(cycle),
    capped: {
      triage: triage.length >= GROUP_LIMIT,
      started: started.length >= GROUP_LIMIT,
      assigned: assigned.length >= GROUP_LIMIT,
      cycle: cycle.length >= GROUP_LIMIT,
    },
    cycleIsFallback,
    triageEnabled: teams.some((team) => team.triageEnabled),
  };
}

/** One issue, by identifier (`ENG-123`) or id, with its thread. */
export async function fetchIssue(apiKey: string, id: string, fetchImpl?: FetchLike): Promise<LinearIssueDetail> {
  const request = createLinearRequest(apiKey, fetchImpl);
  const data = await request<{
    viewer: RawUser;
    issue:
      | (RawIssue & {
          description?: string | null;
          labels: Nodes<{ id: string; name: string; color: string }>;
          comments: Nodes<RawComment>;
          team: { id: string; key: string; name: string; states: Nodes<RawState> };
        })
      | null;
  }>(ISSUE_DETAIL_QUERY, { id });

  if (!data.issue) throw new LinearError('not-found', `Linear has no issue ${id}.`);

  return {
    ...mapIssue(data.issue),
    description: data.issue.description ?? '',
    labels: list(data.issue.labels),
    comments: list(data.issue.comments).map(mapComment),
    workflowStates: list(data.issue.team.states)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(mapState),
    viewer: mapUser(data.viewer),
  };
}

// ── Writes ───────────────────────────────────────────────────────────

export async function createComment(
  apiKey: string,
  issueId: string,
  body: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const request = createLinearRequest(apiKey, fetchImpl);
  const data = await request<{ commentCreate: { success: boolean } }>(CREATE_COMMENT_MUTATION, { issueId, body });
  if (!data.commentCreate.success) throw new LinearError('unknown', 'Linear did not accept the comment.');
}

/** The one Linear write outside comments, and the only thing needing a Write key. */
export async function setIssueState(
  apiKey: string,
  id: string,
  stateId: string,
  fetchImpl?: FetchLike,
): Promise<LinearWorkflowState> {
  const request = createLinearRequest(apiKey, fetchImpl);
  const data = await request<{ issueUpdate: { success: boolean; issue: { state: RawState } | null } }>(
    SET_STATE_MUTATION,
    { id, stateId },
  );
  if (!data.issueUpdate.success || !data.issueUpdate.issue) {
    throw new LinearError('unknown', 'Linear did not accept the state change.');
  }
  return mapState(data.issueUpdate.issue.state);
}

// ── Mapping ──────────────────────────────────────────────────────────

function mapIssue(raw: RawIssue): LinearIssueSummary {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    priority: raw.priority,
    priorityLabel: raw.priorityLabel,
    state: mapState(raw.state),
    team: raw.team,
    branchName: raw.branchName,
    ...(raw.assignee ? { assignee: mapUser(raw.assignee) } : {}),
    ...(raw.creator ? { creator: mapUser(raw.creator) } : {}),
    ...(raw.estimate != null ? { estimate: raw.estimate } : {}),
    ...(raw.cycle
      ? { cycle: { id: raw.cycle.id, number: raw.cycle.number, ...(raw.cycle.name ? { name: raw.cycle.name } : {}) } }
      : {}),
  };
}

function mapState(raw: RawState): LinearWorkflowState {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type as LinearWorkflowState['type'],
    color: raw.color,
  };
}

function mapUser(raw: RawUser): LinearUser {
  return {
    id: raw.id,
    name: raw.name,
    displayName: raw.displayName,
    ...(raw.avatarUrl ? { avatarUrl: raw.avatarUrl } : {}),
  };
}

/** Linear comments render as the timeline entries GitHub's comments already do. */
function mapComment(raw: RawComment): TimelineItem {
  return {
    id: raw.id,
    kind: 'comment',
    author: raw.user?.displayName ?? raw.user?.name ?? 'Unknown',
    ...(raw.user?.avatarUrl ? { authorAvatarUrl: raw.user.avatarUrl } : {}),
    body: raw.body,
    createdAt: raw.createdAt,
    url: raw.url,
  };
}
