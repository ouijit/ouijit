import type { LinearAvailability, LinearIssueDetail, LinearIssueGroups, LinearIssueSummary } from '../../linear/types';

/** What the Linear half of the panel is handed, filled in enough to render. */

const STATE = { id: 'state-1', name: 'Todo', type: 'unstarted' as const, color: '#e2e2e2' };

export function linearIssue(over: Partial<LinearIssueSummary> & { identifier: string }): LinearIssueSummary {
  return {
    id: `issue-${over.identifier}`,
    title: `Issue ${over.identifier}`,
    url: `https://linear.app/acme/issue/${over.identifier}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    priority: 0,
    priorityLabel: 'No priority',
    state: STATE,
    team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
    branchName: `someone/${over.identifier.toLowerCase()}-do-the-thing`,
    ...over,
  };
}

export function linearGroups(over: Partial<LinearIssueGroups> = {}): LinearIssueGroups {
  return {
    triage: [],
    started: [],
    assigned: [],
    cycle: [],
    capped: { triage: false, started: false, assigned: false, cycle: false },
    cycleIsFallback: false,
    triageEnabled: true,
    ...over,
  };
}

export function linearAvailability(over: Partial<LinearAvailability> = {}): LinearAvailability {
  return {
    connected: true,
    viewer: {
      id: 'user-1',
      name: 'Me',
      displayName: 'me',
      workspaceId: 'workspace-1',
      workspaceName: 'Acme',
    },
    storage: 'keychain',
    source: 'app',
    scope: { kind: 'repo-label', labelId: 'label-1', name: 'o/r' },
    repoLabels: [{ id: 'label-1', name: 'o/r' }],
    teams: [{ id: 'team-1', key: 'ENG', name: 'Engineering', triageEnabled: true }],
    ...over,
  };
}

export function linearDetail(over: Partial<LinearIssueDetail> & { identifier: string }): LinearIssueDetail {
  return {
    ...linearIssue(over),
    description: 'what needs doing',
    labels: [],
    comments: [],
    workflowStates: [STATE, { id: 'state-2', name: 'In Progress', type: 'started', color: '#f2c94c' }],
    viewer: { id: 'user-1', name: 'Me', displayName: 'me' },
    ...over,
  };
}
