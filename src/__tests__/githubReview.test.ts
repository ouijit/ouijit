import { describe, test, expect } from 'vitest';
import { anchorForLine } from '../components/diff/diffAnchor';
import { classifyGhError, parseGhVersion, versionAtLeast, MIN_GH_VERSION } from '../github/client';
import { deriveMergeStatus } from '../github/api';
import { parseDiff } from '../git';
import type { DiffLine } from '../types';

describe('review anchors', () => {
  // These four cases are the diff-source decision in miniature: if the line
  // numbers a local `base...head` diff produces are not the numbers GitHub
  // expects in `line`/`side`, every review comment lands on the wrong line.
  test('a deletion anchors LEFT at its base-blob line', () => {
    const line: DiffLine = { type: 'deletion', content: 'gone', oldLineNo: 42 };
    expect(anchorForLine(line)).toEqual({ line: 42, side: 'LEFT' });
  });

  test('an addition anchors RIGHT at its head-blob line', () => {
    const line: DiffLine = { type: 'addition', content: 'new', newLineNo: 17 };
    expect(anchorForLine(line)).toEqual({ line: 17, side: 'RIGHT' });
  });

  test('a context line anchors RIGHT — it exists in the head blob', () => {
    const line: DiffLine = { type: 'context', content: 'same', oldLineNo: 8, newLineNo: 9 };
    expect(anchorForLine(line)).toEqual({ line: 9, side: 'RIGHT' });
  });

  test('a line with no number for its side cannot be anchored', () => {
    expect(anchorForLine({ type: 'deletion', content: 'x' })).toBeNull();
    expect(anchorForLine({ type: 'addition', content: 'x' })).toBeNull();
  });

  test('anchors derived from a parsed hunk are real file line numbers', () => {
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

describe('merge blockers', () => {
  const clean = {
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    reviewDecision: 'APPROVED' as const,
    checksState: 'success' as const,
  };

  test('a clean, approved, green PR has nothing standing in the way', () => {
    expect(deriveMergeStatus(clean)).toEqual({ mergeable: 'MERGEABLE', stateStatus: 'CLEAN', blockers: [] });
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

  test('an unknown mergeable value is normalized rather than passed through', () => {
    expect(deriveMergeStatus({ ...clean, mergeable: 'UNKNOWN' }).mergeable).toBe('UNKNOWN');
    expect(deriveMergeStatus({ ...clean, mergeable: 'nonsense' }).mergeable).toBe('UNKNOWN');
  });
});
