/**
 * Turning a Linear issue into work: the task it makes, the branch it starts on,
 * and what an agent's comment does instead of posting.
 *
 * Real database, real git repo. Only Linear's network is replayed.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { _resetCacheForTesting, getTaskByNumber, setGlobalSetting } from '../../db';
import { experimentalStorageKey } from '../../experimentalFlags';
import { invalidateCredentialCache } from '../../linear/credentials';
import {
  createTaskFromIssue,
  discardDraft,
  getIssue,
  invalidateScopeOptions,
  listDrafts,
  resolveIssueId,
  saveDraft,
  setCredential,
} from '../../linear/service';
import { startTask } from '../../worktree';
import { issueDetailResponse, issueRefResponse, viewerResponse } from './linearResponses';

let tmpDir: string;
let repoDir: string;
const posted: string[] = [];

beforeEach(async () => {
  _resetCacheForTesting();
  invalidateCredentialCache();
  invalidateScopeOptions();
  posted.length = 0;

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-linear-task-'));
  repoDir = path.join(tmpDir, 'project');
  await fs.mkdir(repoDir, { recursive: true });
  execSync('git init', { cwd: repoDir });
  execSync('git config user.email "test@test.com"', { cwd: repoDir });
  execSync('git config user.name "Test"', { cwd: repoDir });
  execSync('git commit --allow-empty -m "Initial commit"', { cwd: repoDir });

  await setGlobalSetting(experimentalStorageKey(repoDir), JSON.stringify({ linear: true }));
  await setCredential('lin_api_test');

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      if (sent.query.includes('commentCreate')) {
        posted.push(String(sent.variables.body));
        return json({ data: { commentCreate: { success: true } } });
      }
      if (sent.query.includes('organization')) return json(viewerResponse());
      const identifier = String(sent.variables.id ?? 'ENG-2');
      return sent.query.includes('comments(')
        ? json(issueDetailResponse({ identifier }))
        : json(issueRefResponse({ identifier }));
    }),
  );
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('an issue becoming work', () => {
  test('the task carries the issue, and a second task for it is refused', async () => {
    const created = await createTaskFromIssue(repoDir, 'ENG-2');
    expect(created.success).toBe(true);

    const task = (await getTaskByNumber(repoDir, created.taskNumber!))!;
    expect(task.name).toBe('Issue ENG-2');
    expect(task.linearIssueIdentifier).toBe('ENG-2');
    expect(task.linearIssueId).toBe('issue-2');
    expect(task.suggestedBranch).toBe('mel/eng-2-do-the-thing');
    // The description carries the issue's own text and a way back to it.
    expect(task.prompt).toContain('Split the onboarding wizard');
    expect(task.prompt).toContain('https://linear.app/acme/issue/ENG-2');

    const second = await createTaskFromIssue(repoDir, 'ENG-2');
    expect(second.success).toBe(false);
    expect(second.error).toContain(`ENG-2 is already linked to task #${created.taskNumber}`);
  });

  /**
   * Read from the task rather than fetched: starting must not depend on the
   * network, and an explicit branch still wins.
   */
  test('a task started from an issue lands on the branch Linear suggested', async () => {
    const created = await createTaskFromIssue(repoDir, 'ENG-2');
    const started = await startTask(repoDir, created.taskNumber!);

    expect(started.success).toBe(true);
    expect((await getTaskByNumber(repoDir, created.taskNumber!))!.branch).toBe('mel/eng-2-do-the-thing');

    const other = await createTaskFromIssue(repoDir, 'ENG-3');
    await startTask(repoDir, other.taskNumber!, 'my-own-branch');
    expect((await getTaskByNumber(repoDir, other.taskNumber!))!.branch).toBe('my-own-branch');
  });

  /**
   * The rule `github_review_drafts` already encodes: an agent in a task
   * terminal has no human gate, so what it writes waits for one.
   */
  test('a comment written by an agent stages rather than posts', async () => {
    // What the CLI holds is `ENG-2`; drafts are keyed by the issue's own id, so
    // one written against the identifier is the one the panel then reads.
    const issueId = await resolveIssueId(repoDir, 'ENG-2');
    const draft = await saveDraft(repoDir, issueId, 'this can throw when the token is missing', 'claude');

    expect(issueId).toBe('issue-2');
    expect(draft.origin).toBe('claude');
    expect(posted).toEqual([]);

    const staged = await listDrafts(repoDir, (await getIssue(repoDir, 'ENG-2')).id);
    expect(staged.map((d) => d.body)).toEqual(['this can throw when the token is missing']);

    // Discarding says which issue it was on, so the panel can refresh that one.
    expect(await discardDraft(repoDir, draft.id)).toEqual({ success: true, issueId: 'issue-2' });
    expect(await listDrafts(repoDir, issueId)).toEqual([]);
  });
});
