import { describe, test, expect } from 'vitest';
import { UNCOMMITTED_BASE, describeDiffComparison, diffSubject, filesInDiff, isUncommittedBase } from '../diffSource';
import type { ChangedFile, GitFileStatus } from '../git';

function file(path: string): ChangedFile {
  return { path, status: 'M', additions: 1, deletions: 0 };
}

function status(changed: string[], untracked: string[]): GitFileStatus {
  return {
    branch: 'feat/x',
    mainBranch: 'main',
    base: 'main',
    commitsAheadOfMain: 1,
    changedFiles: changed.map(file),
    untrackedFiles: untracked.map((path) => ({ ...file(path), status: '?' as const })),
  };
}

describe('what the panel is comparing', () => {
  test('the last commit is the base that leaves the uncommitted changes', () => {
    expect(isUncommittedBase(UNCOMMITTED_BASE, 'feat/x')).toBe(true);
  });

  test('so is the branch itself, which has nothing on it the branch lacks', () => {
    expect(isUncommittedBase('main', 'main')).toBe(true);
  });

  test('another branch is not', () => {
    expect(isUncommittedBase('origin/main', 'feat/x')).toBe(false);
  });
});

describe('how a comparison reads', () => {
  test('names the ref, so a remote base is never mistaken for a local one', () => {
    expect(describeDiffComparison('origin/main', 'feat/x')).toBe('vs origin/main');
    expect(diffSubject('origin/main', 'feat/x')).toBe('the changes against origin/main');
  });

  test('the uncommitted comparison is named by what it means, not by its ref', () => {
    expect(describeDiffComparison(UNCOMMITTED_BASE, 'feat/x')).toBe('Uncommitted changes');
    expect(diffSubject(UNCOMMITTED_BASE, 'feat/x')).toBe('the uncommitted changes');
  });
});

describe('the files a comparison contains', () => {
  test('untracked files join whatever it is compared against', () => {
    const files = filesInDiff(status(['a.ts'], ['new.ts']));
    expect(files.map((f) => f.path)).toEqual(['a.ts', 'new.ts']);
  });

  test('and are all there is when nothing tracked differs', () => {
    expect(filesInDiff(status([], ['new.ts'])).map((f) => f.path)).toEqual(['new.ts']);
  });
});
