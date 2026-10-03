/**
 * What a project's Linear issues are, and what happens when the key changes.
 *
 * The network is the only thing faked: every response is a recorded Linear
 * payload replayed through the injected fetch, so the shapes the mapping reads
 * are the shapes Linear sends. The database and the git repo are real.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _resetCacheForTesting, getGlobalSetting, setGlobalSetting } from '../../db';
import { experimentalStorageKey } from '../../experimentalFlags';
import { invalidateRepoIdentity } from '../../github/repoIdentity';
import { invalidateCredentialCache } from '../../linear/credentials';
import { linearScopeKey } from '../../linear/scope';
import {
  getAvailability,
  getConnection,
  getIssues,
  invalidateScopeOptions,
  setCredential,
  setScope,
} from '../../linear/service';
import { issuesResponse, scopeOptionsResponse, viewerResponse } from './linearResponses';

let tmpDir: string;
let repoDir: string;

/** Replays a recorded payload per document, and records what was asked. */
function replay(responses: Array<{ match: string; body: unknown }>) {
  const asked: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    asked.push(sent);
    const hit = responses.find((r) => sent.query.includes(r.match));
    if (!hit) throw new Error(`No recorded response for: ${sent.query.slice(0, 60)}`);
    return new Response(JSON.stringify(hit.body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchImpl, asked };
}

beforeEach(async () => {
  _resetCacheForTesting();
  invalidateCredentialCache();
  invalidateScopeOptions();

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-linear-'));
  repoDir = path.join(tmpDir, 'project');
  await fs.mkdir(repoDir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });
  git('init');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
  invalidateRepoIdentity(repoDir);

  await setGlobalSetting(experimentalStorageKey(repoDir), JSON.stringify({ linear: true }));
  await setCredential('lin_api_test');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('scoping a project to Linear', () => {
  test('a repo label matching the git remote is offered without being asked for', async () => {
    const { fetchImpl } = replay([
      { match: 'organization', body: viewerResponse() },
      { match: 'issueLabels', body: scopeOptionsResponse() },
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    const availability = await getAvailability(repoDir);

    expect(availability.connected).toBe(true);
    expect(availability.viewer?.workspaceName).toBe('Acme');
    // The remote is acme/widgets, and the workspace labels one of its issues
    // with exactly that under the `repo` group.
    expect(availability.suggestedLabel).toEqual({ id: 'label-widgets', name: 'acme/widgets' });
    expect(availability.scope).toBeUndefined();
  });

  test('a key from another workspace drops the stored scope instead of emptying the list', async () => {
    const { fetchImpl } = replay([
      { match: 'organization', body: viewerResponse() },
      { match: 'issueLabels', body: scopeOptionsResponse() },
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    await setScope(repoDir, { kind: 'repo-label', labelId: 'label-widgets', name: 'acme/widgets' });
    expect(await getGlobalSetting(linearScopeKey(repoDir))).toContain('workspace-acme');

    // A key re-pasted from somewhere else: the same project, a workspace whose
    // label ids mean nothing here.
    invalidateCredentialCache();
    invalidateScopeOptions();
    const other = replay([
      { match: 'organization', body: viewerResponse({ workspaceId: 'workspace-other', workspaceName: 'Other' }) },
      { match: 'issueLabels', body: scopeOptionsResponse() },
    ]);
    vi.stubGlobal('fetch', other.fetchImpl);

    const availability = await getAvailability(repoDir, true);

    expect(availability.scope).toBeUndefined();
    expect(await getGlobalSetting(linearScopeKey(repoDir))).toBe('');
    expect(await getIssues(repoDir)).toBeNull();
  });

  test('the scope becomes a filter on every group, and no issue lands in two', async () => {
    const { fetchImpl, asked } = replay([
      { match: 'organization', body: viewerResponse() },
      { match: 'issueLabels', body: scopeOptionsResponse() },
      { match: 'triage: issues', body: issuesResponse() },
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    await setScope(repoDir, { kind: 'repo-label', labelId: 'label-widgets', name: 'acme/widgets' });
    const groups = await getIssues(repoDir);

    expect(groups).not.toBeNull();
    const issuesQuery = asked.find((a) => a.query.includes('triage: issues'))!;
    expect(issuesQuery.variables.scope).toEqual({ labels: { some: { id: { eq: 'label-widgets' } } } });

    // ENG-2 is both started-and-mine and in the active cycle. The first group
    // that claims it keeps it.
    expect(groups!.started.map((i) => i.identifier)).toEqual(['ENG-2']);
    expect(groups!.cycle.map((i) => i.identifier)).toEqual(['ENG-3']);
    const everywhere = [...groups!.triage, ...groups!.started, ...groups!.assigned, ...groups!.cycle];
    expect(new Set(everywhere.map((i) => i.id)).size).toBe(everywhere.length);

    // The suggested branch rides along, so starting a task from an issue never
    // has to ask Linear again.
    expect(groups!.started[0].branchName).toBe('mel/eng-2-rework-the-onboarding-flow');
  });

  test('a team scope filters by team instead, and triage follows the team', async () => {
    const { fetchImpl, asked } = replay([
      { match: 'organization', body: viewerResponse() },
      { match: 'issueLabels', body: scopeOptionsResponse({ triageEnabled: false }) },
      { match: 'triage: issues', body: issuesResponse() },
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    await setScope(repoDir, { kind: 'team', teamId: 'team-eng', name: 'Engineering' });
    const groups = await getIssues(repoDir);

    const issuesQuery = asked.find((a) => a.query.includes('triage: issues'))!;
    expect(issuesQuery.variables.scope).toEqual({ team: { id: { eq: 'team-eng' } } });
    // Triage is opt-in per team; with it off nothing renders that group.
    expect(groups!.triageEnabled).toBe(false);
  });

  test('a refused key says where that key is set', async () => {
    const refused = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: [{ message: 'Authentication required', extensions: { type: 'authentication error' } }],
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', refused);

    expect((await getConnection(repoDir)).message).toBe("Linear didn't accept the API key. Check it in App Settings.");

    await setCredential('lin_api_own', repoDir);
    expect((await getConnection(repoDir, true)).message).toBe(
      "Linear didn't accept the API key. Check it in Project Settings.",
    );
  });
});
