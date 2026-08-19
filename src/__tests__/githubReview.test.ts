import { describe, test, expect } from 'vitest';
import { anchorForLine } from '../diffAnchor';
import { unanchoredThreads } from '../components/github/reviewAnchors';
import { classifyGhError, parseGhVersion, MIN_GH_VERSION, activeGhCount, runGh } from '../github/client';
import { versionAtLeast } from '../utils/semver';
import { deriveMergeStatus, mergeArgs } from '../github/api';
import { parseDiff } from '../git';
import type { ReviewThread } from '../github/types';

describe('review anchors', () => {
  test('a line with no number for its side cannot be anchored', () => {
    expect(anchorForLine({ type: 'deletion', content: 'x' })).toBeNull();
    expect(anchorForLine({ type: 'addition', content: 'x' })).toBeNull();
  });

  test('a thread whose anchor no line offers is surfaced rather than lost', () => {
    const hunks = parseDiff(['@@ -10,2 +10,2 @@', ' unchanged line', '-removed line', '+added line'].join('\n'));
    const diffs = new Map([['a.ts', { path: 'a.ts', hunks, isBinary: false }]]);
    const files = [{ path: 'a.ts' }];
    const thread = (over: Partial<ReviewThread>): ReviewThread => ({
      id: 't',
      path: 'a.ts',
      line: 10,
      originalLine: null,
      side: 'RIGHT',
      isResolved: false,
      isOutdated: false,
      comments: [],
      ...over,
    });

    const orphans = unanchoredThreads(
      [
        // Renders inline: the context line anchors RIGHT at 10.
        thread({ id: 'anchored' }),
        // GitHub takes a LEFT comment on the left pane of that same context
        // line, but the line only ever draws its RIGHT anchor.
        thread({ id: 'left-on-context', line: 10, side: 'LEFT' }),
        // Outdated threads fall back to originalLine; this one has neither.
        thread({ id: 'no-line', line: null }),
        // The file isn't in the diff at all.
        thread({ id: 'other-file', path: 'gone.ts' }),
      ],
      files,
      diffs,
    );
    expect(orphans.map((t) => t.id)).toEqual(['left-on-context', 'no-line', 'other-file']);

    // A file whose diff hasn't loaded yet is pending, not unanchorable —
    // listing it here would flash every thread into the orphan list on open.
    expect(unanchoredThreads([thread({ id: 'anchored' })], files, new Map())).toEqual([]);
  });

  test('anchors derived from a parsed hunk are real file line numbers', () => {
    // The diff-source decision in miniature: if the line numbers a local
    // `base...head` diff produces are not the numbers GitHub expects in
    // `line`/`side`, every review comment lands on the wrong line.
    //
    // A hunk starting at line 10 on both sides: one context, one deletion, one
    // addition. The anchors must be 10 (context, RIGHT), 11 (deletion, LEFT),
    // and 11 (addition, RIGHT) — file positions, never offsets into the patch.
    const hunks = parseDiff(['@@ -10,2 +10,2 @@', ' unchanged line', '-removed line', '+added line'].join('\n'));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.map(anchorForLine)).toEqual([
      { line: 10, side: 'RIGHT' },
      { line: 11, side: 'LEFT' },
      { line: 11, side: 'RIGHT' },
    ]);
  });
});

describe('gh concurrency gate', () => {
  /**
   * A smoke test on the invariant, not a reproduction: the overshoot this
   * guards against needs a caller to enter during the microtask between a slot
   * being freed and the woken waiter claiming it, which no scheduling this test
   * can arrange reaches reliably. Handing the slot straight to the waiter makes
   * the count conserved by construction; this checks the cap and the drain.
   */
  test('holds the cap under a burst and gives every slot back', async () => {
    let peak = 0;

    // `gh --version` is the cheapest real invocation; twenty of them at once is
    // well past the cap of four.
    const calls = Array.from({ length: 20 }, () =>
      runGh(['--version']).then(
        () => undefined,
        () => undefined,
      ),
    );
    const watch = setInterval(() => {
      peak = Math.max(peak, activeGhCount());
    }, 1);

    await Promise.all(calls);
    clearInterval(watch);

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(4);
    // Every slot handed back at the end.
    expect(activeGhCount()).toBe(0);
  });
});

describe('gh error classification', () => {
  test.each([
    ['gh: Not Found (HTTP 404)', 'not-found'],
    ['gh: Bad credentials (HTTP 401)', 'unauthorized'],
    ['gh: Resource not accessible by integration (HTTP 403)', 'forbidden'],
    ['API rate limit exceeded for user ID 1', 'rate-limited'],
    ['You have exceeded a secondary rate limit', 'rate-limited'],
    ['dial tcp: lookup api.github.com: no such host', 'network'],
    ['Could not resolve to a Repository with the name', 'not-found'],
  ] as const)('maps %s to %s', (stderr, kind) => {
    expect(classifyGhError(stderr).kind).toBe(kind);
  });

  test('a missing binary is distinguished from a failed request', () => {
    expect(classifyGhError('spawn gh ENOENT', 127).kind).toBe('gh-missing');
  });

  test('an unrecognised failure keeps its first line as the message', () => {
    const error = classifyGhError('gh: something unexpected went wrong\nstack trace line\nmore noise');
    expect(error.kind).toBe('unknown');
    expect(error.message).toBe('something unexpected went wrong');
  });

  test('rate limiting is matched before auth — the message mentions both concepts', () => {
    // GitHub's secondary-limit response also talks about authentication;
    // reporting it as "run gh auth login" would send the user somewhere useless.
    expect(classifyGhError('You have exceeded a secondary rate limit. Please authenticate.').kind).toBe('rate-limited');
  });
});

describe('gh version floor', () => {
  test('parses the version out of gh --version output', () => {
    expect(parseGhVersion('gh version 2.85.0 (2026-01-14)\nhttps://github.com/cli/cli/releases')).toBe('2.85.0');
    expect(parseGhVersion('not gh output')).toBeNull();
  });

  test.each([
    ['2.48.0', true],
    ['2.85.0', true],
    ['3.0.0', true],
    // 2.47 has every flag but `gh api --slurp`, which paginated reads need.
    ['2.47.1', false],
    ['2.20.0', false],
    ['1.14.0', false],
  ])('%s meets the floor: %s', (version, expected) => {
    expect(versionAtLeast(version, MIN_GH_VERSION)).toBe(expected);
  });

  test('compares numerically, not lexically', () => {
    expect(versionAtLeast('2.100.0', '2.20.0')).toBe(true);
    expect(versionAtLeast('2.9.0', '2.20.0')).toBe(false);
  });
});

describe('merging', () => {
  const clean = {
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    reviewDecision: 'APPROVED' as const,
    checksState: 'success' as const,
    viewerCanMergeAsAdmin: false,
  };

  test('a clean, approved, green PR has nothing standing in the way', () => {
    expect(deriveMergeStatus(clean)).toEqual({
      mergeable: 'MERGEABLE',
      stateStatus: 'CLEAN',
      blockers: [],
      hardBlock: null,
      canBypass: false,
    });
  });

  test('conflicts, drafts, failing checks and requested changes each surface', () => {
    const status = deriveMergeStatus({
      ...clean,
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      isDraft: true,
      reviewDecision: 'CHANGES_REQUESTED',
      checksState: 'failure',
    });
    expect(status.mergeable).toBe('CONFLICTING');
    expect(status.blockers).toEqual([
      'Pull request is a draft',
      'Conflicts must be resolved',
      'Changes were requested',
      'Checks are failing',
    ]);
    expect(status.hardBlock).toBe('Mark the pull request ready for review first');
    expect(deriveMergeStatus({ ...clean, mergeable: 'CONFLICTING' }).hardBlock).toBe('Resolve the conflicts first');
    expect(deriveMergeStatus({ ...clean, checksState: 'failure' }).hardBlock).toBeNull();
  });

  test('a behind branch is reported as needing an update rather than as generic blockage', () => {
    expect(deriveMergeStatus({ ...clean, mergeStateStatus: 'BEHIND' }).blockers).toEqual([
      'Branch is behind the base and must be updated',
    ]);
  });

  test('BLOCKED only falls back to branch protection when nothing else explains it', () => {
    expect(deriveMergeStatus({ ...clean, mergeStateStatus: 'BLOCKED' }).blockers).toEqual([
      'Blocked by a branch protection rule',
    ]);
    // With a concrete cause present, the vague message would be noise.
    expect(deriveMergeStatus({ ...clean, mergeStateStatus: 'BLOCKED', checksState: 'failure' }).blockers).toEqual([
      'Checks are failing',
    ]);
  });

  test('bypass is offered only for what a bypass can actually clear', () => {
    const admin = { ...clean, viewerCanMergeAsAdmin: true };
    expect(deriveMergeStatus({ ...admin, mergeStateStatus: 'BLOCKED' }).canBypass).toBe(true);
    expect(deriveMergeStatus({ ...admin, mergeable: 'CONFLICTING' }).canBypass).toBe(false);
    expect(deriveMergeStatus({ ...admin, isDraft: true }).canBypass).toBe(false);
    expect(deriveMergeStatus(admin).canBypass).toBe(false);
    expect(deriveMergeStatus({ ...clean, mergeStateStatus: 'BLOCKED' }).canBypass).toBe(false);
  });

  test('gh is told to bypass only when asked to', () => {
    const identity = { host: 'github.com', owner: 'o', repo: 'r' };
    expect(mergeArgs(identity, 7, { method: 'squash', deleteBranch: true, bypass: false })).toEqual([
      'pr',
      'merge',
      '7',
      '--repo',
      'o/r',
      '--squash',
      '--delete-branch',
    ]);
    expect(mergeArgs(identity, 7, { method: 'merge', deleteBranch: false, bypass: true })).toEqual([
      'pr',
      'merge',
      '7',
      '--repo',
      'o/r',
      '--merge',
      '--admin',
    ]);
  });

  test('an unknown mergeable value is normalized rather than passed through', () => {
    expect(deriveMergeStatus({ ...clean, mergeable: 'UNKNOWN' }).mergeable).toBe('UNKNOWN');
    expect(deriveMergeStatus({ ...clean, mergeable: 'nonsense' }).mergeable).toBe('UNKNOWN');
  });
});
