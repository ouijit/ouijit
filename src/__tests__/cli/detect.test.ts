import { describe, test, expect, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { _resetCacheForTesting, addProject } from '../../db';
import { detectProject } from '../../cli/detect';

describe('detectProject', () => {
  let tempDir: string;

  beforeEach(() => {
    _resetCacheForTesting();
    // Resolve symlinks (macOS /var → /private/var) so paths match git output
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-detect-')));
  });

  test('returns explicit path when provided', () => {
    fs.mkdirSync(path.join(tempDir, 'myproject'), { recursive: true });
    const result = detectProject(path.join(tempDir, 'myproject'));
    expect(result).toBe(path.join(tempDir, 'myproject'));
  });

  test('returns null for nonexistent explicit path', () => {
    const result = detectProject('/does/not/exist');
    expect(result).toBeNull();
  });

  test('detects project from git repo CWD', () => {
    const repoPath = path.join(tempDir, 'repo');
    fs.mkdirSync(repoPath);
    execSync('git init', { cwd: repoPath, stdio: 'ignore' });

    const orig = process.cwd();
    process.chdir(repoPath);
    try {
      const result = detectProject();
      expect(result).toBe(repoPath);
    } finally {
      process.chdir(orig);
    }
  });

  test('resolves main repo root from worktree', async () => {
    // Create main repo with an initial commit
    const mainRepo = path.join(tempDir, 'main-repo');
    fs.mkdirSync(mainRepo);
    execSync('git init', { cwd: mainRepo, stdio: 'ignore' });
    execSync('git commit --allow-empty -m "init"', { cwd: mainRepo, stdio: 'ignore' });

    // Add project to DB (mainRepo is a real directory, so addProject validation passes)
    await addProject(mainRepo);

    // Create a worktree
    const wtPath = path.join(tempDir, 'wt-1');
    execSync(`git worktree add -b test-branch "${wtPath}"`, { cwd: mainRepo, stdio: 'ignore' });

    const orig = process.cwd();
    process.chdir(wtPath);
    try {
      const result = detectProject();
      expect(result).toBe(mainRepo);
    } finally {
      process.chdir(orig);
    }
  });

  test('returns null when not in a git repo', () => {
    const noGit = path.join(tempDir, 'no-git');
    fs.mkdirSync(noGit);

    const orig = process.cwd();
    process.chdir(noGit);
    try {
      const result = detectProject();
      expect(result).toBeNull();
    } finally {
      process.chdir(orig);
    }
  });
});
