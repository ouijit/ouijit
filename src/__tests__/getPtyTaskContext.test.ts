/**
 * Verifies getPtyTaskContext sees PTYs registered via the sandbox bridge.
 * The sandbox spawn path doesn't enter `activePtys`; it registers its
 * { projectPath, taskId } via registerSandboxPty. This is the bit task
 * 326 will eventually unify — until then, the helper has to cover both maps.
 */
import { describe, test, expect } from 'vitest';
import { getPtyTaskContext, registerSandboxPty, unregisterSandboxPty, isPtyActive } from '../ptyManager';

describe('getPtyTaskContext', () => {
  test('returns null for unknown ptyId', () => {
    expect(getPtyTaskContext('pty-does-not-exist')).toBeNull();
  });

  test('resolves task context for a registered sandbox PTY', () => {
    registerSandboxPty('pty-sb-1', { projectPath: '/p', taskId: 42 });
    try {
      expect(isPtyActive('pty-sb-1')).toBe(true);
      expect(getPtyTaskContext('pty-sb-1')).toEqual({ projectPath: '/p', taskId: 42 });
    } finally {
      unregisterSandboxPty('pty-sb-1');
    }
    expect(isPtyActive('pty-sb-1')).toBe(false);
    expect(getPtyTaskContext('pty-sb-1')).toBeNull();
  });

  test('returns null for sandbox PTYs without a taskId (e.g. project-mode shells)', () => {
    registerSandboxPty('pty-sb-2', { projectPath: '/p' });
    try {
      expect(isPtyActive('pty-sb-2')).toBe(true);
      expect(getPtyTaskContext('pty-sb-2')).toBeNull();
    } finally {
      unregisterSandboxPty('pty-sb-2');
    }
  });
});
