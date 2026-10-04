/**
 * The Linear feature's main-process entry points.
 *
 * IPC handlers and the REST router call in here rather than touching `api.ts`,
 * so flag gating, credential resolution, scope resolution, error shaping and
 * the task-link side effects happen in one place.
 *
 * The key never leaves this process. Callers get who it belongs to and what it
 * can see — never the key, and no REST route returns it.
 */

import { randomUUID } from 'node:crypto';
import {
  createTask,
  getGlobalSetting,
  findLinearDraft,
  getLinearDrafts,
  getNextTaskNumber,
  getProjectTasks,
  getTaskByNumber,
  saveLinearDraft,
  deleteLinearDraft,
  setTaskLinearIssue,
  type LinearDraftRow,
} from '../db';
import { experimentalStorageKey, parseExperimentalFlags } from '../experimentalFlags';
import { getLogger } from '../logger';
import { getRepoIdentity } from '../github/repoIdentity';
import { repoSlug } from '../github/types';
import { LinearError } from './client';
import { createComment, fetchIssue, fetchIssueGroups, fetchIssueRef, fetchScopeOptions, setIssueState } from './api';
import {
  invalidateCredentialCache,
  maskCredential,
  readCredential,
  resolveViewer,
  writeCredential,
  type StoredCredential,
} from './credentials';
import { matchRepoLabel, readScope, writeScope } from './scope';
import type {
  LinearAvailability,
  LinearRepoLabel,
  LinearCommentDraft,
  LinearConnection,
  LinearIssueDetail,
  LinearIssueGroups,
  LinearIssueRef,
  LinearScope,
  LinearTeam,
} from './types';
import type { TaskFromGithubResult } from '../github/types';

const linearLog = getLogger().scope('linear:service');

export async function isLinearEnabled(projectPath: string): Promise<boolean> {
  const raw = await getGlobalSetting(experimentalStorageKey(projectPath));
  return parseExperimentalFlags(raw).linear;
}

// ── The key ──────────────────────────────────────────────────────────

/**
 * Whether a key works and who it belongs to.
 *
 * With no project it answers for the app-wide key, which is what App Settings
 * shows. With one it answers for whatever that project actually reads Linear
 * with — its own key where it keeps one.
 */
export async function getConnection(projectPath?: string, recheck = false): Promise<LinearConnection> {
  const credential = await readCredential(projectPath);
  if (!credential) {
    return { connected: false, reason: 'no-credential' };
  }
  const viewer = await resolveViewer(projectPath, recheck);
  const standing = {
    storage: credential.storage,
    source: credential.source,
    masked: maskCredential(credential.apiKey),
  };

  if (viewer instanceof LinearError) {
    const message = viewer.kind === 'unauthorized' ? `${viewer.message} ${whereToFix(credential)}` : viewer.message;
    return { ...standing, connected: false, reason: viewer.kind, message };
  }
  if (!viewer) return { connected: false, reason: 'no-credential' };
  return { ...standing, connected: true, viewer };
}

function whereToFix(credential: StoredCredential): string {
  if (credential.storage === 'environment') return 'Check LINEAR_API_KEY.';
  return credential.source === 'project' ? 'Check it in Project Settings.' : 'Check it in App Settings.';
}

/**
 * Paste a key, or clear it with an empty string. A project's own key overrides
 * the app's; clearing it puts the project back on the app's.
 */
export async function setCredential(
  apiKey: string,
  projectPath?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await writeCredential(apiKey, projectPath);
  // Everything, when the app-wide key moved: every project not keeping its own
  // was reading it.
  invalidateCredentialCache(projectPath);
  invalidateScopeOptions(projectPath);
  return result;
}

/** The key itself, for the calls that need it. Never returned to a caller. */
async function requireKey(projectPath: string): Promise<string> {
  if (!(await isLinearEnabled(projectPath))) {
    throw new LinearError('no-credential', "Linear isn't enabled for this project.");
  }
  const credential = await readCredential(projectPath);
  if (!credential) throw new LinearError('no-credential', 'No API key. Add one in App Settings.');
  return credential.apiKey;
}

// ── Scope ────────────────────────────────────────────────────────────

/**
 * What the panel needs to render the Linear half: the key's standing, the
 * scope if there is one, and what to pre-fill the connect row with if not.
 *
 * A scope stored under a different workspace is dropped rather than used: its
 * label and team ids mean nothing to this key, and the list would go quietly
 * empty instead of asking again.
 */
export async function getAvailability(projectPath: string, recheck = false): Promise<LinearAvailability> {
  if (!(await isLinearEnabled(projectPath))) {
    return { connected: false, reason: 'flag-off', repoLabels: [], teams: [] };
  }

  // A recheck re-probes everything cached for the life of the process, so a
  // team or a `repo` label added since the app started is picked up by the
  // refresh button rather than by a restart.
  if (recheck) invalidateScopeOptions(projectPath);

  const connection = await getConnection(projectPath, recheck);
  if (!connection.connected || !connection.viewer) {
    return { ...connection, repoLabels: [], teams: [] };
  }

  // Three lookups that answer to the credential rather than to each other. The
  // scope options carry their failure in the result: thrown, it would take the
  // other two down with it.
  const [options, stored, identity] = await Promise.all([
    scopeOptions(projectPath).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ),
    readScope(projectPath),
    getRepoIdentity(projectPath),
  ]);

  if ('error' in options) {
    const failure = describe(options.error);
    return {
      ...connection,
      connected: false,
      message: failure.error,
      ...(failure.reason ? { reason: failure.reason } : {}),
      repoLabels: [],
      teams: [],
    };
  }

  if (stored && stored.workspaceId !== connection.viewer.workspaceId) {
    linearLog.info('dropping a scope stored under another workspace', { projectPath });
    await writeScope(projectPath, null);
  }
  const scope = stored?.workspaceId === connection.viewer.workspaceId ? stored.scope : undefined;
  const suggested = matchRepoLabel(options.value.repoLabels, identity ? repoSlug(identity) : null);

  return {
    ...connection,
    ...(scope ? { scope } : {}),
    ...(suggested ? { suggestedLabel: suggested } : {}),
    repoLabels: options.value.repoLabels,
    teams: options.value.teams,
  };
}

type ScopeOptions = { teams: LinearTeam[]; repoLabels: LinearRepoLabel[] };

/**
 * The key's teams and `repo` labels, kept for the life of the process.
 *
 * Every panel open and every issue load asks what the scope is, and the answer
 * changes when someone adds a team — not between two reads a second apart.
 * Cleared with the credential, which is when it can actually differ, and keyed
 * per project for the same reason the viewer is: another key, another
 * workspace, other teams.
 */
const cachedOptions = new Map<string, Promise<ScopeOptions>>();

export function invalidateScopeOptions(projectPath?: string): void {
  if (projectPath) cachedOptions.delete(projectPath);
  else cachedOptions.clear();
}

async function scopeOptions(projectPath: string): Promise<ScopeOptions> {
  const existing = cachedOptions.get(projectPath);
  if (existing) return existing;

  const credential = await readCredential(projectPath);
  if (!credential) throw new LinearError('no-credential', 'No API key.');
  const pending = fetchScopeOptions(credential.apiKey).catch((error: unknown) => {
    cachedOptions.delete(projectPath);
    throw error;
  });
  cachedOptions.set(projectPath, pending);
  return pending;
}

/** Connect this project to a label or a team, stamped with the key's workspace. */
export async function setScope(
  projectPath: string,
  scope: LinearScope | null,
): Promise<{ success: boolean; error?: string }> {
  const viewer = await resolveViewer(projectPath);
  if (!viewer || viewer instanceof LinearError) {
    return { success: false, error: "This API key isn't working." };
  }
  await writeScope(projectPath, scope ? { workspaceId: viewer.workspaceId, scope } : null);
  return { success: true };
}

// ── Reads ────────────────────────────────────────────────────────────

/** Every group of this project's Linear issues, or none when it has no scope. */
export async function getIssues(projectPath: string): Promise<LinearIssueGroups | null> {
  const apiKey = await requireKey(projectPath);
  const viewer = await resolveViewer(projectPath);
  if (viewer instanceof LinearError) throw viewer;
  if (!viewer) throw new LinearError('no-credential', 'No API key.');

  const stored = await readScope(projectPath);
  if (!stored || stored.workspaceId !== viewer.workspaceId) return null;

  const { teams } = await scopeOptions(projectPath);
  return fetchIssueGroups(apiKey, stored.scope, teams);
}

export async function getIssue(projectPath: string, id: string): Promise<LinearIssueDetail> {
  const apiKey = await requireKey(projectPath);
  return fetchIssue(apiKey, id);
}

// ── Writes ───────────────────────────────────────────────────────────

export async function comment(
  projectPath: string,
  issueId: string,
  body: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await createComment(await requireKey(projectPath), issueId, body);
    return { success: true };
  } catch (error) {
    return { success: false, error: describe(error).error };
  }
}

export async function moveIssue(
  projectPath: string,
  issueId: string,
  stateId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await setIssueState(await requireKey(projectPath), issueId, stateId);
    return { success: true };
  } catch (error) {
    return { success: false, error: describe(error).error };
  }
}

// ── Drafts ───────────────────────────────────────────────────────────
//
// A person pressing send in the app is the human gate, which is why the panel's
// composer posts directly. An agent in a task terminal has no such gate, so
// what it writes is staged here and sent by a person.

export async function listDrafts(projectPath: string, issueId: string): Promise<LinearCommentDraft[]> {
  return (await getLinearDrafts(projectPath, issueId)).map(toDraft);
}

export async function saveDraft(
  projectPath: string,
  issueId: string,
  body: string,
  origin: string,
): Promise<LinearCommentDraft> {
  return toDraft(await saveLinearDraft({ id: randomUUID(), projectPath, issueId, body, origin }));
}

/** Answers with the issue it was staged against, so a caller can refresh it. */
export async function discardDraft(
  projectPath: string,
  draftId: string,
): Promise<{ success: boolean; issueId?: string }> {
  const draft = await findLinearDraft(projectPath, draftId);
  if (!draft) return { success: false };
  await deleteLinearDraft(draftId);
  return { success: true, issueId: draft.issue_id };
}

/**
 * The issue's id, from an id or an identifier.
 *
 * Drafts are keyed by id: an issue that changes team changes identifier, and
 * comments staged against it must not orphan. The CLI has the identifier —
 * `ENG-214` is what a person and an agent both hold — so this is where the two
 * meet.
 */
export async function resolveIssueId(projectPath: string, idOrIdentifier: string): Promise<string> {
  const apiKey = await requireKey(projectPath);
  if (UUID.test(idOrIdentifier)) return idOrIdentifier.toLowerCase();
  return (await fetchIssueRef(apiKey, idOrIdentifier)).id;
}

/** Linear ids are UUIDs; an identifier is `ENG-214`, which is not one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Post a staged comment and drop it, which is what pressing Send does. */
export async function sendDraft(projectPath: string, draftId: string): Promise<{ success: boolean; error?: string }> {
  const draft = await findLinearDraft(projectPath, draftId);
  if (!draft) return { success: false, error: 'This comment no longer exists.' };
  const result = await comment(projectPath, draft.issue_id, draft.body);
  if (!result.success) return result;
  await deleteLinearDraft(draftId);
  return { success: true };
}

function toDraft(row: LinearDraftRow): LinearCommentDraft {
  return {
    id: row.id,
    projectPath: row.project_path,
    issueId: row.issue_id,
    body: row.body,
    origin: row.origin,
    createdAt: row.created_at,
  };
}

// ── Task linking ─────────────────────────────────────────────────────

export async function linkTaskToIssue(
  projectPath: string,
  taskNumber: number,
  identifier: string | null,
): Promise<{ success: boolean; error?: string }> {
  if (!identifier) return setTaskLinearIssue(projectPath, taskNumber, null);

  let issue: LinearIssueRef;
  try {
    issue = await fetchIssueRef(await requireKey(projectPath), identifier);
  } catch (error) {
    return { success: false, error: describe(error).error };
  }

  const claimed = await claimedBy(projectPath, issue.id, taskNumber);
  if (claimed) {
    return { success: false, error: `${issue.identifier} is already linked to task #${claimed}` };
  }

  return setTaskLinearIssue(projectPath, taskNumber, {
    id: issue.id,
    identifier: issue.identifier,
    suggestedBranch: issue.branchName,
  });
}

/**
 * A todo carrying the issue's description, linked back so the branch and the
 * pull request opened from it later point Linear at the work.
 */
export async function createTaskFromIssue(projectPath: string, identifier: string): Promise<TaskFromGithubResult> {
  let issue: LinearIssueRef;
  try {
    issue = await fetchIssueRef(await requireKey(projectPath), identifier);
  } catch (error) {
    return { success: false, error: describe(error).error };
  }

  const claimed = await claimedBy(projectPath, issue.id);
  if (claimed) {
    return { success: false, error: `${issue.identifier} is already linked to task #${claimed}` };
  }

  const taskNumber = await getNextTaskNumber(projectPath);
  const description = issue.description.trim() ? `${issue.description.trim()}\n\n${issue.url}` : issue.url;
  await createTask(projectPath, taskNumber, issue.title, {
    status: 'todo',
    prompt: description,
    linearIssueId: issue.id,
    linearIssueIdentifier: issue.identifier,
    suggestedBranch: issue.branchName,
  });
  return { success: true, taskNumber };
}

/** The task already holding this issue, so a second cannot start on its branch. */
async function claimedBy(projectPath: string, issueId: string, except?: number): Promise<number | null> {
  const claimed = (await getProjectTasks(projectPath)).find(
    (task) => task.linearIssueId === issueId && task.taskNumber !== except,
  );
  return claimed?.taskNumber ?? null;
}

/** The identifier a linked task carries, for the pull request body. */
export async function issueIdentifierForTask(projectPath: string, taskNumber: number): Promise<string | null> {
  return (await getTaskByNumber(projectPath, taskNumber))?.linearIssueIdentifier ?? null;
}

// ── Errors ───────────────────────────────────────────────────────────

/**
 * One shape for every failure that crosses a channel: a message, never a stack
 * — a Linear error carries the request that caused it, headers included.
 */
function describe(error: unknown): { error: string; reason?: LinearError['kind'] } {
  if (error instanceof LinearError) return { error: error.message, reason: error.kind };
  linearLog.warn('unexpected Linear failure');
  return { error: 'Something went wrong. Try again.' };
}
