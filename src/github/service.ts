/**
 * The GitHub feature's main-process entry points.
 *
 * IPC handlers and the REST router both call in here rather than
 * touching `api.ts` / `prDiff.ts` directly, so availability gating, error
 * shaping, and the task-link side effects happen in exactly one place.
 *
 * Every `gh` call runs on the host from the main process. The sandbox policy
 * that strips `GITHUB_TOKEN` from guest environments is untouched — no guest
 * ever gets GitHub credentials, directly or by proxy.
 */

import { randomUUID } from 'node:crypto';
import { getCachedHealth, checkHealth, refreshHealth } from '../healthCheck';
import {
  getTaskByNumber,
  getProjectTasks,
  setTaskGithubPr,
  setTaskGithubIssue,
  getReviewDraft,
  getReviewDrafts,
  saveReviewDraft,
  reanchorReviewDraft,
  deleteReviewDraft,
  getReviewDraftCounts,
  getGlobalSetting,
  createTask,
  getNextTaskNumber,
  type ReviewDraftRow,
} from '../db';
import { experimentalStorageKey, parseExperimentalFlags } from '../experimentalFlags';
import { pushBranch } from '../git';
import { getLogger } from '../logger';
import { getRepoIdentity, invalidateRepoIdentity } from './repoIdentity';
import { GithubError, MIN_GH_VERSION, probeGhAuth } from './client';
import { reviewSubmitProblem } from './reviewRules';
import { describeError } from '../utils/describeError';
import {
  fetchInbox,
  fetchPullRequest,
  fetchPullRequestFreshness,
  fetchPullRequestFiles,
  fetchIssues,
  fetchIssue,
  findPullRequestForBranch,
  submitReview,
  replyToReviewComment,
  addIssueComment,
  deleteComment as deleteCommentApi,
  setThreadResolved,
  createPullRequest,
  mergePullRequest,
  type DraftReviewComment,
} from './api';
import { getPrFileDiff, getPrFileVersions, getPrDiffFiles, createPrHeadBranch, prunePrRefs } from './prDiff';
import type {
  PrHead,
  GithubAvailability,
  PullRequestDetail,
  PullRequestFreshness,
  PullRequestFile,
  GithubIssue,
  IssueDetail,
  CommentKind,
  ReviewDraft,
  ReviewEvent,
  MergeOptions,
  RepoIdentity,
  InboxResult,
  PullRequestFilesResult,
  SaveDraftInput,
  SubmitReviewResult,
  TaskFromGithubResult,
  PromoteToTaskResult,
  PrFileVersions,
} from './types';
import type { FileDiff, ChangedFile } from '../types';
import { locateInHunks } from '../snippetAnchor';
import { linesOnSide } from '../diffAnchor';

const ghLog = getLogger().scope('github:service');

// ── Availability ─────────────────────────────────────────────────────

export async function isGithubEnabled(projectPath: string): Promise<boolean> {
  const raw = await getGlobalSetting(experimentalStorageKey(projectPath));
  return parseExperimentalFlags(raw).github;
}

/**
 * `gh auth status` is a network call, so it is not part of the startup health
 * probe. It runs here instead, the first time anything asks whether the panel
 * can open, and is then cached for the life of the process like the rest of
 * availability. A recheck re-probes so the `gh auth login` the message asks for
 * takes effect without a restart.
 */
let ghAuth: Promise<boolean> | null = null;

function isGhAuthenticated(recheck: boolean): Promise<boolean> {
  if (recheck || !ghAuth) ghAuth = probeGhAuth();
  return ghAuth;
}

/**
 * Whether the GitHub surface can run for a project, and why not when it can't.
 *
 * The panel stays hidden rather than showing a blank screen, and the reason is
 * surfaced wherever the feature would otherwise be missing without explanation.
 */
export async function getAvailability(projectPath: string, recheck = false): Promise<GithubAvailability> {
  if (!(await isGithubEnabled(projectPath))) {
    return { available: false, reason: 'flag-off' };
  }

  // A recheck re-probes everything that is otherwise cached for the life of the
  // process. Negative results are cached too, so without one a project opened
  // before `git remote add origin` reads "no remote" until the app restarts,
  // and a gh installed after launch stays missing.
  if (recheck) invalidateRepoIdentity(projectPath);
  const health = recheck ? await refreshHealth() : (getCachedHealth() ?? (await checkHealth()));

  if (!health.gh) {
    return {
      available: false,
      reason: 'gh-missing',
      message: 'The GitHub CLI is not installed. Install it from cli.github.com, then reopen this panel.',
    };
  }
  if (!health.ghVersionOk) {
    return {
      available: false,
      reason: 'gh-too-old',
      message: `The GitHub CLI is ${health.ghVersion ?? 'an unknown version'}; this needs ${MIN_GH_VERSION} or newer.`,
    };
  }
  if (!(await isGhAuthenticated(recheck))) {
    return {
      available: false,
      reason: 'gh-unauthenticated',
      message: 'The GitHub CLI is not signed in. Run `gh auth login` in a terminal, then refresh.',
    };
  }

  const identity = await getRepoIdentity(projectPath);
  if (!identity) {
    return {
      available: false,
      reason: 'no-remote',
      message: 'This project has no `origin` remote pointing at a GitHub repository.',
    };
  }

  return { available: true, identity };
}

/**
 * Resolve a project to its repo, throwing the availability message when the
 * feature is not usable. Every read and write path funnels through this so a
 * disabled flag or a missing `gh` can never reach a `gh` invocation.
 */
async function requireIdentity(projectPath: string): Promise<RepoIdentity> {
  const availability = await getAvailability(projectPath);
  if (!availability.available || !availability.identity) {
    throw new GithubError(
      availability.reason === 'gh-unauthenticated' ? 'unauthorized' : 'unknown',
      availability.message ?? 'GitHub is not available for this project',
    );
  }
  return availability.identity;
}

// ── Reads ────────────────────────────────────────────────────────────

export async function getInbox(projectPath: string): Promise<InboxResult> {
  const identity = await requireIdentity(projectPath);
  const [inbox, draftCounts, tasks] = await Promise.all([
    fetchInbox(identity),
    getReviewDraftCounts(projectPath),
    getProjectTasks(projectPath),
  ]);

  const linkedTasks: Record<number, number> = {};
  for (const task of tasks) {
    if (task.githubPrNumber != null) linkedTasks[task.githubPrNumber] = task.taskNumber;
  }

  return { ...inbox, draftCounts, linkedTasks };
}

export async function getPullRequest(projectPath: string, number: number): Promise<PullRequestDetail> {
  const identity = await requireIdentity(projectPath);
  return fetchPullRequest(identity, number);
}

/**
 * Whether a refresh would bring anything back, asked without fetching it.
 *
 * The caller compares this against what it has on screen: nothing here knows
 * what that is, and a check that answered "up to date" from main would have to
 * be told anyway.
 */
export async function getPullRequestFreshness(projectPath: string, number: number): Promise<PullRequestFreshness> {
  const identity = await requireIdentity(projectPath);
  return fetchPullRequestFreshness(identity, number);
}

/**
 * The changed-file list. GitHub's list is preferred because its rename
 * detection is authoritative, but a failure there falls back to git rather
 * than leaving the view empty — the bytes come from git either way.
 */
export async function getPullRequestFiles(
  projectPath: string,
  number: number,
  baseSha: string,
  headSha: string,
): Promise<PullRequestFilesResult> {
  const identity = await requireIdentity(projectPath);
  try {
    return { files: await fetchPullRequestFiles(identity, number), fromGit: false };
  } catch (error) {
    ghLog.warn('API file list failed, falling back to git', { number, error: describeError(error) });
    const result = await getPrDiffFiles(projectPath, number, baseSha, headSha);
    if (!result.success || !result.files) {
      return { files: [], fromGit: true, error: result.error };
    }
    return { files: result.files.map(fromChangedFile), fromGit: true };
  }
}

function fromChangedFile(file: ChangedFile): PullRequestFile {
  return {
    path: file.path,
    status: file.status === '?' ? 'A' : file.status,
    ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    additions: file.additions,
    deletions: file.deletions,
  };
}

/** One file's hunks, read from the local object database. */
export async function getPullRequestFileDiff(
  projectPath: string,
  number: number,
  baseSha: string,
  headSha: string,
  filePath: string,
  contextLines?: number,
  oldPath?: string,
): Promise<FileDiff | null> {
  return getPrFileDiff(projectPath, number, baseSha, headSha, filePath, contextLines, oldPath);
}

/** Both sides of a binary file, for the image viewer. */
export async function getPullRequestFileVersions(
  projectPath: string,
  number: number,
  baseSha: string,
  headSha: string,
  filePath: string,
  oldPath?: string,
): Promise<PrFileVersions> {
  return getPrFileVersions(projectPath, number, baseSha, headSha, filePath, oldPath);
}

export async function getIssues(projectPath: string): Promise<GithubIssue[]> {
  const identity = await requireIdentity(projectPath);
  return fetchIssues(identity);
}

/** One issue and its thread, fetched by number rather than found in the list. */
export async function getIssue(projectPath: string, number: number): Promise<IssueDetail> {
  const identity = await requireIdentity(projectPath);
  return fetchIssue(identity, number);
}

// ── Task linking ─────────────────────────────────────────────────────

/**
 * Attach a PR to a task, or detach with null. Detaching also prunes the fetched
 * refs so a long-lived project doesn't accumulate one per PR ever reviewed.
 */
export async function linkTaskToPr(
  projectPath: string,
  taskNumber: number,
  prNumber: number | null,
): Promise<{ success: boolean; error?: string }> {
  const previous = (await getTaskByNumber(projectPath, taskNumber))?.githubPrNumber;
  const result = await setTaskGithubPr(projectPath, taskNumber, prNumber);
  if (result.success && previous != null && previous !== prNumber) {
    await prunePrRefs(projectPath, previous);
  }
  return result;
}

export async function linkTaskToIssue(
  projectPath: string,
  taskNumber: number,
  issueNumber: number | null,
): Promise<{ success: boolean; error?: string }> {
  return setTaskGithubIssue(projectPath, taskNumber, issueNumber);
}

/**
 * Look for an existing PR whose head is the task's branch, and link it.
 *
 * Called when a task loads, so a PR opened from a terminal (or by a teammate on
 * the same branch) shows up on the card without the user telling the app about
 * it. Silently does nothing when the feature is off or the task has no branch.
 */
export async function detectPullRequestForTask(
  projectPath: string,
  taskNumber: number,
): Promise<{ prNumber: number | null }> {
  const task = await getTaskByNumber(projectPath, taskNumber);
  if (!task?.branch) return { prNumber: null };
  if (task.githubPrNumber != null) return { prNumber: task.githubPrNumber };

  const availability = await getAvailability(projectPath);
  if (!availability.available || !availability.identity) return { prNumber: null };

  const prNumber = await findPullRequestForBranch(availability.identity, task.branch, task.worktreePath);
  if (prNumber != null) await setTaskGithubPr(projectPath, taskNumber, prNumber);
  return { prNumber };
}

// ── Review drafts ────────────────────────────────────────────────────

function toDraft(row: ReviewDraftRow, head?: string): ReviewDraft {
  return {
    id: row.id,
    projectPath: row.project_path,
    prNumber: row.pr_number,
    path: row.path,
    line: row.line,
    side: row.side,
    startLine: row.start_line ?? row.line,
    // A draft with no head recorded predates any of this being tracked, which
    // is not evidence that it cannot be placed.
    ...(head && row.head_sha && row.head_sha !== head ? { unplaceable: true } : {}),
    body: row.body,
    createdAt: row.created_at,
    origin: row.origin,
    ...(row.reply_to_thread_id ? { replyToThreadId: row.reply_to_thread_id } : {}),
    ...(row.reply_to_comment_id != null ? { replyToCommentId: row.reply_to_comment_id } : {}),
  };
}

/**
 * The drafts on a pull request, each followed into the diff at `head` first.
 *
 * Given no head — the CLI and REST callers, which have no diff on screen to
 * anchor against — the drafts are returned as they were stored.
 */
export async function listDrafts(projectPath: string, prNumber: number, head?: PrHead): Promise<ReviewDraft[]> {
  const rows = await getReviewDrafts(projectPath, prNumber);
  if (head) await reanchorDrafts(projectPath, prNumber, rows, head);
  return rows.map((row) => toDraft(row, head?.headSha));
}

/**
 * Move drafts written against an earlier head onto the lines their code sits at
 * now, and leave the ones that are nowhere to be found.
 *
 * A left-behind draft keeps its old anchor and its old head, which is what
 * `toDraft` reads to call it unplaceable. Deleting it instead would throw away
 * writing over a force-push the author may well undo.
 */
async function reanchorDrafts(
  projectPath: string,
  prNumber: number,
  rows: ReviewDraftRow[],
  head: PrHead,
): Promise<void> {
  const diffs = new Map<string, FileDiff | null>();

  for (const row of rows) {
    if (row.head_sha === head.headSha || !row.snippet || row.reply_to_comment_id != null) continue;

    if (!diffs.has(row.path)) {
      diffs.set(
        row.path,
        await getPrFileDiff(projectPath, prNumber, head.baseSha, head.headSha, row.path).catch(
          (): FileDiff | null => null,
        ),
      );
    }

    const found = locateInHunks(linesOnSide(diffs.get(row.path), row.side), row.snippet, row.start_line ?? row.line);
    if (!found) continue;

    row.start_line = found.startLine;
    row.line = found.line;
    row.head_sha = head.headSha;
    await reanchorReviewDraft(row.id, found.startLine, found.line, head.headSha);
  }
}

export async function saveDraft(projectPath: string, input: SaveDraftInput): Promise<ReviewDraft> {
  const existing = input.id ? await getReviewDraft(input.id) : null;
  // A draft id is unique across every project, and the write below is an
  // upsert, so an id belonging to somewhere else would not be rejected — it
  // would be *moved* here, taking its body with it. The CLI and REST callers
  // supply the id, so it is checked rather than trusted.
  if (existing && (existing.project_path !== projectPath || existing.pr_number !== input.prNumber)) {
    throw new Error(`Draft ${input.id} belongs to another pull request`);
  }
  const row = await saveReviewDraft({
    id: input.id ?? randomUUID(),
    project_path: projectPath,
    pr_number: input.prNumber,
    path: input.path,
    line: input.line,
    side: input.side,
    start_line: input.startLine ?? input.line,
    snippet: input.snippet ?? null,
    head_sha: input.headSha ?? null,
    body: input.body,
    reply_to_thread_id: input.replyToThreadId ?? null,
    reply_to_comment_id: input.replyToCommentId ?? null,
    // Preserve the original timestamp on edit so drafts keep their write order.
    created_at: existing?.created_at ?? new Date().toISOString(),
    // An edit with no stated origin is a renderer edit, and rewriting the text
    // makes you the author — provenance does not survive being overwritten.
    origin: input.origin ?? 'human',
  });
  return toDraft(row);
}

/** A draft's id is unique on its own, so the project it belongs to is not asked for. */
export async function discardDraft(draftId: string): Promise<{ success: boolean }> {
  await deleteReviewDraft(draftId);
  return { success: true };
}

// ── Writes ───────────────────────────────────────────────────────────

/**
 * Send every batched draft up as one review.
 *
 * Replies to existing threads can't ride inside the reviews payload, so those
 * go first as individual reply calls; whatever is left is a new-thread comment
 * and travels in the single `POST /pulls/{n}/reviews`.
 *
 * Each draft is dropped the moment its own write lands, rather than all of them
 * at the end. A failure part way through — one stale line anchor is enough for
 * a 422 — leaves the unsent writing intact but does not resurrect the replies
 * GitHub already has, which would otherwise be posted a second time on the
 * retry. Drafts are also deleted by id: a batch submit is seconds of network,
 * and anything written during it is not part of what was sent.
 */
export async function submitPullRequestReview(
  projectPath: string,
  prNumber: number,
  event: ReviewEvent,
  body: string,
): Promise<SubmitReviewResult> {
  const identity = await requireIdentity(projectPath);
  const drafts = await getReviewDrafts(projectPath, prNumber);

  const replies = drafts.filter((d) => d.reply_to_comment_id != null);
  const newThreadDrafts = drafts.filter((d) => d.reply_to_comment_id == null);
  const newThreads: DraftReviewComment[] = newThreadDrafts.map((d) => ({
    path: d.path,
    line: d.line,
    side: d.side,
    ...(d.start_line != null && d.start_line !== d.line ? { start_line: d.start_line, start_side: d.side } : {}),
    body: d.body,
  }));

  const problem = reviewSubmitProblem(event, body, newThreads.length + replies.length);
  if (problem) return { success: false, error: problem };

  try {
    for (const reply of replies) {
      await replyToReviewComment(identity, prNumber, reply.reply_to_comment_id!, reply.body);
      await deleteReviewDraft(reply.id);
    }
    const result = await submitReview(identity, prNumber, event, body, newThreads);
    for (const draft of newThreadDrafts) {
      await deleteReviewDraft(draft.id);
    }
    return { success: true, url: result.url };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

export async function commentOnPullRequest(
  projectPath: string,
  prNumber: number,
  body: string,
): Promise<{ success: boolean; error?: string }> {
  if (!body.trim()) return { success: false, error: 'Comment is empty' };
  try {
    const identity = await requireIdentity(projectPath);
    await addIssueComment(identity, prNumber, body);
    return { success: true };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

/**
 * Delete one comment on GitHub.
 *
 * Whether the viewer is allowed to is GitHub's call, not ours — the detail
 * query asks for `viewerCanDelete` per comment and the UI only offers this
 * where that is true, so a refusal here means the answer changed underneath us.
 */
export async function deleteComment(
  projectPath: string,
  kind: CommentKind,
  commentId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const identity = await requireIdentity(projectPath);
    await deleteCommentApi(identity, kind, commentId);
    return { success: true };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

export async function replyToThread(
  projectPath: string,
  prNumber: number,
  commentId: number,
  body: string,
): Promise<{ success: boolean; error?: string }> {
  if (!body.trim()) return { success: false, error: 'Reply is empty' };
  try {
    const identity = await requireIdentity(projectPath);
    await replyToReviewComment(identity, prNumber, commentId, body);
    return { success: true };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

export async function resolveThread(
  projectPath: string,
  threadId: string,
  resolved: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const identity = await requireIdentity(projectPath);
    await setThreadResolved(identity, threadId, resolved);
    return { success: true };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

export interface CreatePrFromTaskResult {
  success: boolean;
  error?: string;
  url?: string;
  prNumber?: number;
}

/**
 * Task to PR: push the task's branch, then open a pull request for it.
 *
 * Hung off the same seam `shipWorktree` uses, and routed through `gh pr create`
 * rather than the raw API so the repo's PR template and closing keywords
 * (`Fixes #123`) behave the way they would from GitHub's own UI. A task created
 * from an issue gets that closing keyword appended automatically.
 */
export async function createPullRequestForTask(
  projectPath: string,
  taskNumber: number,
  options: { title?: string; body?: string; base?: string; draft?: boolean } = {},
): Promise<CreatePrFromTaskResult> {
  const task = await getTaskByNumber(projectPath, taskNumber);
  if (!task) return { success: false, error: 'Task not found' };
  if (!task.branch) return { success: false, error: 'Task has no branch to open a pull request from' };

  let identity: RepoIdentity;
  try {
    identity = await requireIdentity(projectPath);
  } catch (error) {
    return { success: false, error: describeError(error) };
  }

  const cwd = task.worktreePath || projectPath;
  const push = await pushBranch(cwd, task.branch);
  if (!push.success) return { success: false, error: push.error };

  const body = buildPrBody(options.body ?? task.prompt ?? '', task.githubIssueNumber);

  try {
    const result = await createPullRequest(identity, cwd, {
      title: options.title || task.name,
      body,
      base: options.base ?? task.mergeTarget,
      head: task.branch,
      draft: options.draft,
    });
    if (result.number != null) await setTaskGithubPr(projectPath, taskNumber, result.number);
    return { success: true, url: result.url, prNumber: result.number ?? undefined };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

/** Append the closing keyword for a linked issue, unless the body already has one. */
function buildPrBody(body: string, issueNumber?: number): string {
  if (issueNumber == null) return body;
  if (new RegExp(`\\b(closes|fixes|resolves)\\s+#${issueNumber}\\b`, 'i').test(body)) return body;
  return body.trim() ? `${body.trim()}\n\nFixes #${issueNumber}` : `Fixes #${issueNumber}`;
}

export async function mergePr(
  projectPath: string,
  prNumber: number,
  options: MergeOptions,
): Promise<{ success: boolean; error?: string }> {
  try {
    const identity = await requireIdentity(projectPath);
    await mergePullRequest(identity, prNumber, { ...options, cwd: projectPath });
    // The refs were only ever there to render the diff; the PR is now history.
    await prunePrRefs(projectPath, prNumber);
    return { success: true };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

// ── Issue to task, PR to task ────────────────────────────────────────

/**
 * Issue to task: a todo carrying the issue body as its description, linked back
 * so a PR opened from it later closes the issue automatically.
 */
export async function createTaskFromIssue(projectPath: string, issueNumber: number): Promise<TaskFromGithubResult> {
  // By number, not by searching the open list: a closed issue, or one past the
  // list limit, is still something you can turn into a task.
  let issue: IssueDetail;
  try {
    issue = await getIssue(projectPath, issueNumber);
  } catch (error) {
    return { success: false, error: describeError(error) };
  }

  const existing = (await getProjectTasks(projectPath)).find((t) => t.githubIssueNumber === issueNumber);
  if (existing)
    return { success: false, error: `Task #${existing.taskNumber} is already linked to issue #${issueNumber}` };

  const taskNumber = await getNextTaskNumber(projectPath);
  const description = issue.body.trim() ? `${issue.body.trim()}\n\n${issue.url}` : issue.url;
  await createTask(projectPath, taskNumber, issue.title, {
    status: 'todo',
    prompt: description,
    githubIssueNumber: issueNumber,
  });
  return { success: true, taskNumber };
}

/**
 * PR to task: the metadata half of promoting an ephemeral review session into a
 * checked-out task.
 *
 * The `mergeTarget` is set to the PR's base branch, which is worth being
 * explicit about: everywhere else `mergeTarget` means "whatever branch HEAD was
 * on when the task started", and for a teammate's PR that is almost never the
 * base you want to merge back into. The caller creates the worktree at the PR
 * head using the returned refs.
 */
export async function prepareTaskFromPullRequest(projectPath: string, prNumber: number): Promise<PromoteToTaskResult> {
  let pr: PullRequestDetail;
  try {
    pr = await getPullRequest(projectPath, prNumber);
  } catch (error) {
    return { success: false, error: describeError(error) };
  }

  const existing = (await getProjectTasks(projectPath)).find((t) => t.githubPrNumber === prNumber);
  if (existing) {
    return { success: false, error: `Task #${existing.taskNumber} is already linked to pull request #${prNumber}` };
  }

  // Before the task exists, not after: a worktree can only be built at the PR
  // head if the head is already here on a branch. Failing now leaves nothing
  // half-made behind.
  const head = await createPrHeadBranch(projectPath, prNumber, pr.baseSha, pr.headSha, pr.headRefName);
  if (!head.success || !head.branch) {
    return { success: false, error: head.error ?? `Could not fetch pull request #${prNumber}` };
  }

  const taskNumber = await getNextTaskNumber(projectPath);
  await createTask(projectPath, taskNumber, `PR #${pr.number}: ${pr.title}`, {
    status: 'todo',
    prompt: pr.body.trim() ? `${pr.body.trim()}\n\n${pr.url}` : pr.url,
    mergeTarget: pr.baseRefName,
    githubPrNumber: prNumber,
  });

  return {
    success: true,
    taskNumber,
    mergeTarget: pr.baseRefName,
    headRef: head.branch,
  };
}
