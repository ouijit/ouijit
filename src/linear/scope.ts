/**
 * What this project's Linear issues are: the `repo` label matching its git
 * remote, or a team the user picked once.
 *
 * The scope is stored per project, but the key it was resolved under is one for
 * the app — so a stored scope carries the workspace it belongs to, and is
 * dropped when the key starts answering for a different one.
 */

import { getGlobalSetting, setGlobalSetting } from '../db';
import { getLogger } from '../logger';
import type { LinearProjectScope, LinearRepoLabel, LinearScope } from './types';

const scopeLog = getLogger().scope('linear:scope');

/** globalSettings key holding one project's scope. */
export function linearScopeKey(projectPath: string): string {
  return 'linear:' + projectPath;
}

export async function readScope(projectPath: string): Promise<LinearProjectScope | null> {
  const raw = await getGlobalSetting(linearScopeKey(projectPath));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LinearProjectScope;
    return parsed?.workspaceId && parsed?.scope ? parsed : null;
  } catch {
    scopeLog.warn('stored Linear scope is not readable', { projectPath });
    return null;
  }
}

export async function writeScope(projectPath: string, scope: LinearProjectScope | null): Promise<void> {
  await setGlobalSetting(linearScopeKey(projectPath), scope ? JSON.stringify(scope) : '');
}

/**
 * The `repo` label whose name is this project's `owner/repo`. Matched without
 * case, since a label is typed by a person and a remote is not.
 */
export function matchRepoLabel(labels: LinearRepoLabel[], slug: string | null): LinearRepoLabel | undefined {
  if (!slug) return undefined;
  const wanted = slug.toLowerCase();
  return labels.find((label) => label.name.toLowerCase() === wanted);
}

/**
 * The scope as a filter fragment, `and`-ed into every group's filter so
 * switching projects changes the whole list rather than half of it.
 *
 * `labels` is an `IssueLabelCollectionFilter`, so the membership test is
 * `some`. It also accepts a bare `id`, which reads like the same thing and is
 * not.
 */
export function scopeFilter(scope: LinearScope): Record<string, unknown> {
  return scope.kind === 'repo-label'
    ? { labels: { some: { id: { eq: scope.labelId } } } }
    : { team: { id: { eq: scope.teamId } } };
}
