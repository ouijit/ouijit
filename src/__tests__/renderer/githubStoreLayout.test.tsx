import { describe, test, expect, beforeEach } from 'vitest';
import {
  useGithubStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  RAIL_MAX_WIDTH,
} from '../../stores/githubStore';

/**
 * The width and whether the list is showing are not facts about a repository,
 * so they are deliberately held outside the per-project state that gets wiped.
 */
describe('sidebar layout in the store', () => {
  beforeEach(() => {
    useGithubStore.getState().reset();
  });

  test('a width survives switching to another project', () => {
    useGithubStore.getState().setSidebarWidth(420);
    useGithubStore.getState().setSidebarCollapsed(true);

    useGithubStore.getState().setProject('/work/other');

    expect(useGithubStore.getState().sidebarWidth).toBe(420);
    expect(useGithubStore.getState().sidebarCollapsed).toBe(true);
    // The project's own state did clear.
    expect(useGithubStore.getState().detail).toBeNull();
  });

  test('a width outside the limits is brought back inside them', () => {
    useGithubStore.getState().setSidebarWidth(10_000);
    expect(useGithubStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);

    useGithubStore.getState().setSidebarWidth(1);
    expect(useGithubStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
  });

  test('the changed-file rail is kept the same way', () => {
    useGithubStore.getState().setRailWidth(300);
    useGithubStore.getState().setProject('/work/other');
    expect(useGithubStore.getState().railWidth).toBe(300);

    useGithubStore.getState().setRailWidth(10_000);
    expect(useGithubStore.getState().railWidth).toBe(RAIL_MAX_WIDTH);
    useGithubStore.getState().setRailWidth(1);
    expect(useGithubStore.getState().railWidth).toBe(RAIL_MIN_WIDTH);
  });
});
