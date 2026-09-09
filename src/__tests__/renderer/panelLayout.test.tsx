import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useGithubStore, RAIL_MIN_WIDTH, RAIL_MAX_WIDTH } from '../../stores/githubStore';
import { usePanelStore, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '../../stores/panelStore';

/**
 * The width and whether the list is showing are not facts about a repository,
 * so they are deliberately held outside the per-project state that gets wiped —
 * and outside any one source's store, since one list serves all of them.
 */
describe('panel layout and the open slot', () => {
  beforeEach(() => {
    useGithubStore.getState().reset();
    usePanelStore.setState(usePanelStore.getInitialState());
  });

  test('a width survives switching to another project', () => {
    usePanelStore.getState().setSidebarWidth(420);
    usePanelStore.getState().setSidebarCollapsed(true);

    useGithubStore.getState().setProject('/work/other');

    expect(usePanelStore.getState().sidebarWidth).toBe(420);
    expect(usePanelStore.getState().sidebarCollapsed).toBe(true);
    // The project's own state did clear.
    expect(useGithubStore.getState().detail).toBeNull();
  });

  test('a width outside the limits is brought back inside them', () => {
    usePanelStore.getState().setSidebarWidth(10_000);
    expect(usePanelStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);

    usePanelStore.getState().setSidebarWidth(1);
    expect(usePanelStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
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

  /**
   * One slot is what makes two open things impossible, rather than an
   * invariant each source has to maintain against the others.
   */
  test('opening an issue replaces the pull request that was open', async () => {
    vi.mocked(window.api.github.pullRequest).mockRejectedValue(new Error('offline'));
    vi.mocked(window.api.github.issue).mockRejectedValue(new Error('offline'));

    await useGithubStore.getState().openPullRequest('/work/alpha', 42);
    expect(usePanelStore.getState().open).toEqual({ source: 'github-pr', number: 42 });

    await useGithubStore.getState().openIssue('/work/alpha', 7);
    expect(usePanelStore.getState().open).toEqual({ source: 'github-issue', number: 7 });

    useGithubStore.getState().closeDetail();
    expect(usePanelStore.getState().open).toBeNull();
  });
});
