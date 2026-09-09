/**
 * Recorded Linear responses, in the shape its API answers with.
 *
 * The point of replaying these rather than stubbing our own functions is that
 * the fixture cannot drift from the schema: a field the document stops
 * selecting, or a relation that arrives null, shows up here as a mapping bug
 * rather than as a passing test.
 */

const USER = { id: 'user-mel', name: 'Mel Ito', displayName: 'mel', avatarUrl: 'https://linear.app/mel.png' };

const TODO = { id: 'state-todo', name: 'Todo', type: 'unstarted', color: '#e2e2e2', position: 1 };
const STARTED = { id: 'state-started', name: 'In Progress', type: 'started', color: '#f2c94c', position: 2 };
const TRIAGE = { id: 'state-triage', name: 'Triage', type: 'triage', color: '#95a2b3', position: 0 };

const TEAM = { id: 'team-eng', key: 'ENG', name: 'Engineering' };

function issue(over: Record<string, unknown> & { identifier: string }) {
  const number = over.identifier.split('-')[1];
  return {
    id: `issue-${number}`,
    title: `Issue ${over.identifier}`,
    url: `https://linear.app/acme/issue/${over.identifier}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    priority: 0,
    priorityLabel: 'No priority',
    estimate: null,
    branchName: `mel/${over.identifier.toLowerCase()}-do-the-thing`,
    state: TODO,
    team: TEAM,
    assignee: null,
    creator: USER,
    cycle: null,
    ...over,
  };
}

export function viewerResponse(over: { workspaceId?: string; workspaceName?: string } = {}) {
  return {
    data: {
      viewer: USER,
      organization: { id: over.workspaceId ?? 'workspace-acme', name: over.workspaceName ?? 'Acme' },
    },
  };
}

export function scopeOptionsResponse(over: { triageEnabled?: boolean } = {}) {
  return {
    data: {
      teams: { nodes: [{ ...TEAM, triageEnabled: over.triageEnabled ?? true }] },
      issueLabels: {
        nodes: [
          { id: 'label-widgets', name: 'acme/widgets' },
          { id: 'label-other', name: 'acme/other' },
        ],
      },
    },
  };
}

/**
 * ENG-2 is deliberately in two groups at once — assigned and started, and in
 * the active cycle — which is what the exclusion rule is for.
 */
export function issuesResponse() {
  const started = issue({
    identifier: 'ENG-2',
    state: STARTED,
    assignee: USER,
    branchName: 'mel/eng-2-rework-the-onboarding-flow',
    cycle: { id: 'cycle-9', number: 9, name: null },
  });
  return {
    data: {
      viewer: USER,
      triage: { nodes: [] },
      started: { nodes: [started] },
      assigned: { nodes: [] },
      cycle: { nodes: [started, issue({ identifier: 'ENG-3', cycle: { id: 'cycle-9', number: 9, name: null } })] },
    },
  };
}

export function triageResponse() {
  return {
    data: {
      viewer: USER,
      triage: { nodes: [issue({ identifier: 'ENG-7', state: TRIAGE })] },
      started: { nodes: [] },
      assigned: { nodes: [] },
      cycle: { nodes: [] },
    },
  };
}

export function issueDetailResponse(over: { identifier?: string; description?: string } = {}) {
  const identifier = over.identifier ?? 'ENG-2';
  return {
    data: {
      viewer: USER,
      issue: {
        ...issue({ identifier, state: STARTED, assignee: USER }),
        description: over.description ?? 'Split the onboarding wizard into focused steps.',
        labels: { nodes: [{ id: 'label-bug', name: 'Bug', color: '#eb5757' }] },
        comments: {
          nodes: [
            {
              id: 'comment-1',
              body: 'Started on this.',
              createdAt: '2026-07-02T00:00:00.000Z',
              url: `https://linear.app/acme/issue/${identifier}#comment-1`,
              user: USER,
            },
          ],
        },
        team: { ...TEAM, states: { nodes: [STARTED, TODO, TRIAGE] } },
      },
    },
  };
}
