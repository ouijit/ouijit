/**
 * Linear domain types.
 *
 * Must stay a runtime leaf, like `github/types.ts`: `import type` is erased,
 * but a value import here would drag `@linear/sdk` into the renderer bundle.
 */

import type { TimelineItem } from '../issues/types';

/** What went wrong, in terms the panel can render. */
export type LinearErrorKind = 'unauthorized' | 'rate-limited' | 'network' | 'not-found' | 'no-credential' | 'unknown';

export interface LinearUser {
  id: string;
  name: string;
  displayName: string;
  avatarUrl?: string;
}

/**
 * Who the key belongs to, and to which workspace. The workspace id is what
 * catches a key swapped for one from somewhere else: a stored scope points at
 * labels and teams that key cannot see.
 */
export interface LinearViewer {
  id: string;
  name: string;
  displayName: string;
  avatarUrl?: string;
  workspaceId: string;
  workspaceName: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  /** Opt-in per team; the Triage group does not render where every team has it off. */
  triageEnabled: boolean;
}

/** A child of the workspace label group named `repo`, e.g. `ouijit/ouijit`. */
export interface LinearRepoLabel {
  id: string;
  name: string;
}

/**
 * What this project's Linear issues are. Linear has no repository — its model
 * is workspace → teams → projects → issues — so the relation comes from the
 * issue, either through the `repo` label convention or a team picked once.
 */
export type LinearScope =
  | { kind: 'repo-label'; labelId: string; name: string }
  | { kind: 'team'; teamId: string; name: string };

export interface LinearProjectScope {
  workspaceId: string;
  scope: LinearScope;
}

/**
 * `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled` or
 * `duplicate`. Triage being a state type is what lets the Triage group be a
 * filter rather than a special case.
 */
export type LinearStateType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'duplicate';

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: LinearStateType;
  color: string;
}

export interface LinearIssueSummary {
  id: string;
  /** `ENG-123`. Stored on a linked task so a badge can render it offline. */
  identifier: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  /** 0 none, 1 urgent, 2 high, 3 normal, 4 low. */
  priority: number;
  priorityLabel: string;
  state: LinearWorkflowState;
  team: { id: string; key: string; name: string };
  assignee?: LinearUser;
  creator?: LinearUser;
  /** Linear's own suggestion, used as the branch name for a task started from it. */
  branchName: string;
  estimate?: number;
  cycle?: { id: string; number: number; name?: string };
}

export interface LinearIssueDetail extends LinearIssueSummary {
  description: string;
  labels: Array<{ id: string; name: string; color: string }>;
  comments: TimelineItem[];
  /** The team's workflow states, for the state control. Absent without Write. */
  workflowStates: LinearWorkflowState[];
  viewer: LinearUser;
}

/**
 * The Issues list's Linear half, in the order the list reads. Each group
 * excludes what the groups above it hold, so nothing renders twice.
 */
export interface LinearIssueGroups {
  triage: LinearIssueSummary[];
  started: LinearIssueSummary[];
  assigned: LinearIssueSummary[];
  cycle: LinearIssueSummary[];
  /** Each group hit its limit, so it is a page rather than the whole answer. */
  capped: { triage: boolean; started: boolean; assigned: boolean; cycle: boolean };
  /** `cycle` holds the scope's incomplete issues because no cycle is active. */
  cycleIsFallback: boolean;
  /** No team in scope has triage on, so the Triage group is not a thing here. */
  triageEnabled: boolean;
}

/** Where the key is kept. The environment is the answer where there is no keychain. */
export type LinearCredentialStorage = 'keychain' | 'environment';

/**
 * What the renderer is told about the key: enough for the settings row and the
 * connect row, and never the key itself.
 */
export interface LinearConnection {
  connected: boolean;
  /** Why not, when it is not. */
  reason?: LinearErrorKind | 'flag-off';
  message?: string;
  viewer?: LinearViewer;
  storage?: LinearCredentialStorage;
  /** False where `safeStorage` has no keychain, which is why the key is refused. */
  canStore?: boolean;
}

/** What the connect row needs to offer a scope, and the panel to render one. */
export interface LinearAvailability extends LinearConnection {
  scope?: LinearScope;
  /** The `repo` label matching this project's git remote, when there is one. */
  suggestedLabel?: LinearRepoLabel;
  repoLabels: LinearRepoLabel[];
  teams: LinearTeam[];
}

/** A comment written against an issue and held until a person sends it. */
export interface LinearCommentDraft {
  id: string;
  projectPath: string;
  issueId: string;
  body: string;
  /** 'human' when typed here; the caller's name when written by the CLI. */
  origin: string;
  createdAt: string;
}

/**
 * What `linear:drafts-changed` carries. Its handler must stay one local read,
 * for the reason `github:drafts-changed`'s does: a CLI write in another process
 * must not cost a refetch.
 */
export interface LinearDraftsChangedPayload {
  projectPath: string;
  issueId: string;
}
