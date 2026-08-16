import { describe, test, expect } from 'vitest';
import { isAllowedKey } from '../ipc/handlers/settings';
import { diffBaseSettingKey } from '../diffSource';

/**
 * A key the allow-list refuses is refused in both directions and reported as
 * neither — the write answers `{ success: false }` that nothing reads, and the
 * read answers `undefined`, which is indistinguishable from never having been
 * written. Anything the renderer persists has to be checked against it here.
 */
describe('keys the renderer persists through the settings channel', () => {
  test('the diff comparison for a worktree', () => {
    expect(isAllowedKey(diffBaseSettingKey('/Users/x/worktrees/T-7'))).toBe(true);
  });

  test('and a key of some other shape is refused, which is the trap', () => {
    expect(isAllowedKey('diff:base:/Users/x/worktrees/T-7')).toBe(false);
  });
});
