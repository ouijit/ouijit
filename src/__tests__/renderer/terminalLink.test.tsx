import { test, expect, vi } from 'vitest';
import { openTerminalLink } from '../../links/terminalLink';
import { useProjectStore } from '../../stores/projectStore';

test('a link clicked in a terminal goes where its scheme says, and nowhere for schemes it does not know', async () => {
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

  await openTerminalLink('ouijit://nowhere/board', PROJECT, WORKTREE);
  expect(useProjectStore.getState().toasts.map((t) => t.message)).toContain('No project named nowhere');

  vi.mocked(window.api.openExternal).mockClear();
  vi.mocked(window.api.openFileInEditor).mockClear();
  await openTerminalLink('javascript:alert(1)', PROJECT, WORKTREE);
  await openTerminalLink('not a url', PROJECT, WORKTREE);
  expect(window.api.openExternal).not.toHaveBeenCalled();
  expect(window.api.openFileInEditor).not.toHaveBeenCalled();
});
