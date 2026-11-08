import type { GithubIssueList, GithubIssueRow } from '../../github/types';
import type { LinearIssueGroups, LinearIssueSummary } from '../../linear/types';
import type { IssueGroup, IssuePage, IssueRow } from '../../issues/types';
import type { TaskWithWorkspace } from '../../types';
import { stateGlyph } from '../linear/stateGlyph';

export interface GroupInput {
  github: GithubIssueList | null;
  /** `owner/repo`, which names the group holding the rest of the repo's issues. */
  githubSlug: string | null;
  linear: LinearIssueGroups | null;
  /** The label or team this project's Linear issues come from, for the last group. */
  linearScopeName: string | null;
  githubTasks: Record<number, TaskWithWorkspace>;
  linearTasks: Record<string, TaskWithWorkspace>;
}

/**
 * The Issues list, in the order it reads: what wants your attention first.
 *
 * No group is defined by a vendor. `Assigned to you` is answered by both
 * sources at once, and each group is dropped when nothing fills it, so a
 * project with only one tracker connected sees no empty headings.
 */
export function githubIssueRow(issue: GithubIssueRow, tasks: Record<number, TaskWithWorkspace>): IssueRow {
  const open = issue.state === 'open';
  return {
    source: 'github',
    key: String(issue.number),
    identifier: `#${issue.number}`,
    title: issue.title,
    updatedAt: issue.updatedAt,
    author: issue.author,
    ...(issue.authorAvatarUrl ? { authorAvatarUrl: issue.authorAvatarUrl } : {}),
    icon: open ? 'circle-dashed' : 'check-circle',
    tone: open ? 'text-vcs-added' : 'text-vcs-renamed',
    ...(tasks[issue.number] ? { taskNumber: tasks[issue.number].taskNumber } : {}),
  };
}

export function linearIssueRow(issue: LinearIssueSummary, tasks: Record<string, TaskWithWorkspace>): IssueRow {
  // One person, so the name and the face beside it cannot come from two.
  const person = issue.assignee ?? issue.creator;
  return {
    source: 'linear',
    key: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    updatedAt: issue.updatedAt,
    author: person?.displayName ?? 'Unassigned',
    ...(person?.avatarUrl ? { authorAvatarUrl: person.avatarUrl } : {}),
    // Linear's own glyph and colour for the state, so a row reads as the
    // state it is in rather than as one more circle.
    icon: stateGlyph(issue.state.type),
    iconColor: issue.state.color,
    ...(tasks[issue.id] ? { taskNumber: tasks[issue.id].taskNumber } : {}),
  };
}

export function issueGroups({
  github,
  githubSlug,
  linear,
  linearScopeName,
  githubTasks,
  linearTasks,
}: GroupInput): IssueGroup[] {
  const gh = (issue: GithubIssueRow) => githubIssueRow(issue, githubTasks);
  const lin = (issue: LinearIssueSummary) => linearIssueRow(issue, linearTasks);

  const groups: IssueGroup[] = [];
  const add = (label: string, rows: IssueRow[], more: Array<IssuePage | false>) => {
    if (rows.length > 0) groups.push({ label, rows, more: more.filter((page): page is IssuePage => page !== false) });
  };
  const linearMore = (group: 'triage' | 'started' | 'assigned' | 'cycle') =>
    linear?.next[group] != null && ({ source: 'linear', group } as const);

  if (linear?.triageEnabled) add('Triage', linear.triage.map(lin), [linearMore('triage')]);
  if (linear) add('In progress', linear.started.map(lin), [linearMore('started')]);

  add('Assigned to you', byRecency([...(linear?.assigned ?? []).map(lin), ...(github?.assigned ?? []).map(gh)]), [
    linearMore('assigned'),
    github?.assignedNext != null && { source: 'github', group: 'assigned' },
  ]);

  if (linear) {
    // With no active cycle the group is everything unfinished in scope, which
    // is the mirror of the repo's group below rather than a cycle.
    const label = linear.cycleIsFallback ? `Open in ${linearScopeName ?? 'Linear'}` : 'Current cycle';
    add(label, linear.cycle.map(lin), [linearMore('cycle')]);
  }

  add(githubSlug ? `Open on ${githubSlug}` : 'Open', (github?.open ?? []).map(gh), [
    github?.openNext != null && { source: 'github', group: 'open' },
  ]);

  return groups;
}

function byRecency(rows: IssueRow[]): IssueRow[] {
  return [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
