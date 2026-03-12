import { describe, test, expect } from 'vitest';
// formatLogEntry is a pure function — the electron-log/main mock in setup.ts
// prevents the rest of log.ts from accessing Electron APIs.
import { formatLogEntry } from '../log';

describe('formatLogEntry', () => {
  test('produces valid JSON with ts, level, and msg fields', () => {
    const result = formatLogEntry(['hello world'], 'info');
    const parsed = JSON.parse(result);
    expect(parsed.ts).toBeDefined();
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello world');
    expect(parsed.mod).toBeUndefined();
  });

  test('includes mod field when scope is provided', () => {
    const result = formatLogEntry(['test message'], 'warn', 'worktree');
    const parsed = JSON.parse(result);
    expect(parsed.mod).toBe('worktree');
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('test message');
  });

  test('spreads metadata from last plain object argument', () => {
    const result = formatLogEntry(['starting task', { taskNumber: 5, branch: 'feature-5' }], 'info', 'worktree');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toBe('starting task');
    expect(parsed.taskNumber).toBe(5);
    expect(parsed.branch).toBe('feature-5');
    expect(parsed.mod).toBe('worktree');
  });

  test('does not spread arrays as metadata', () => {
    const result = formatLogEntry(['items', [1, 2, 3]], 'info');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toBe('items [1,2,3]');
    expect(parsed[0]).toBeUndefined();
  });

  test('does not spread Error instances as metadata', () => {
    const err = new Error('boom');
    const result = formatLogEntry(['failed', err], 'error');
    const parsed = JSON.parse(result);
    // Error is serialized via JSON.stringify into the msg, not spread
    expect(parsed.msg).toContain('failed');
    expect(parsed.msg).toContain('boom');
    expect(parsed.message).toBeUndefined();
  });

  test('concatenates multiple string arguments', () => {
    const result = formatLogEntry(['part1', 'part2', 'part3'], 'debug');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toBe('part1 part2 part3');
  });

  test('handles empty data array', () => {
    const result = formatLogEntry([], 'info');
    const parsed = JSON.parse(result);
    expect(parsed.msg).toBe('');
  });
});
