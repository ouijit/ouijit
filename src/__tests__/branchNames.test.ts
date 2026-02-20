import { describe, it, expect } from 'vitest';
import { sanitizeBranchName, generateBranchName } from '../worktree';

describe('sanitizeBranchName', () => {
  it('converts normal name to kebab-case', () => {
    expect(sanitizeBranchName('Add login page')).toBe('add-login-page');
  });

  it('removes special characters', () => {
    expect(sanitizeBranchName('fix: bug #123')).toBe('fix-bug-123');
  });

  it('trims leading and trailing spaces', () => {
    expect(sanitizeBranchName('  hello world  ')).toBe('hello-world');
  });

  it('collapses multiple hyphens', () => {
    expect(sanitizeBranchName('foo---bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(sanitizeBranchName('-hello-')).toBe('hello');
  });

  it('returns empty string for all-invalid characters', () => {
    expect(sanitizeBranchName('!!!')).toBe('');
  });

  it('handles empty string', () => {
    expect(sanitizeBranchName('')).toBe('');
  });

  it('lowercases uppercase characters', () => {
    expect(sanitizeBranchName('FIX Login Bug')).toBe('fix-login-bug');
  });
});

describe('generateBranchName', () => {
  it('uses sanitized name with task number', () => {
    expect(generateBranchName('Add login', 5)).toBe('add-login-5');
  });

  it('falls back to task-N for undefined name', () => {
    expect(generateBranchName(undefined, 5)).toBe('task-5');
  });

  it('falls back to task-N for empty string', () => {
    expect(generateBranchName('', 3)).toBe('task-3');
  });

  it('falls back to task-N when name sanitizes to empty', () => {
    expect(generateBranchName('!!!', 3)).toBe('task-3');
  });
});
