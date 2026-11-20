import { test, expect } from 'vitest';
import { openTerminalLink } from '../../links/terminalLink';
import { useProjectStore } from '../../stores/projectStore';

test('a link clicked in a terminal goes where its scheme says, and nowhere for schemes or hosts it does not know', async () => {
  const PROJECT = '/work/alpha';
  const WORKTREE = '/work/alpha-worktrees/T-3';

  await openTerminalLink('https://example.com/a?b=1', PROJECT, WORKTREE);
  expect(window.api.openExternal).toHaveBeenCalledWith('https://example.com/a?b=1');

  await openTerminalLink('file://my-mac.local/work/alpha/src/with%20space.ts', PROJECT, WORKTREE);
  expect(window.api.openFileInEditor).toHaveBeenCalledWith(
    PROJECT,
    WORKTREE,
    '/work/alpha/src/with space.ts',
    undefined,
  );
  await openTerminalLink('file:///work/alpha/src/main.ts#42', PROJECT, WORKTREE);
  expect(window.api.openFileInEditor).toHaveBeenCalledWith(PROJECT, WORKTREE, '/work/alpha/src/main.ts', 42);
  await openTerminalLink('file://devbox/work/alpha/src/main.ts#42', PROJECT, WORKTREE);
  expect(useProjectStore.getState().toasts.map((t) => t.message)).toContain('main.ts is on devbox');

  await openTerminalLink('ouijit://nowhere/board', PROJECT, WORKTREE);
  expect(useProjectStore.getState().toasts.map((t) => t.message)).toContain('No project named nowhere');

  await openTerminalLink('javascript:alert(1)', PROJECT, WORKTREE);
  await openTerminalLink('not a url', PROJECT, WORKTREE);
  await openTerminalLink('file:///work/alpha/%E0%A4%A', PROJECT, WORKTREE);
  expect(window.api.openExternal).toHaveBeenCalledTimes(1);
  expect(window.api.openFileInEditor).toHaveBeenCalledTimes(2);
});
