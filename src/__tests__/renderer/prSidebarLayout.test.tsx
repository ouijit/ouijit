import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { PullRequestSidebar } from '../../components/github/PullRequestSidebar';
import { useGithubStore, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '../../stores/githubStore';
import type { PullRequestSummary } from '../../github/types';

function pr(number: number, title: string): PullRequestSummary {
  return {
    number,
    title,
    author: 'someone',
    url: `https://github.com/o/r/pull/${number}`,
    headRefName: 'branch',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    updatedAt: new Date(0).toISOString(),
  } as PullRequestSummary;
}

describe('PullRequestSidebar layout', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('it is as wide as it has been dragged to', () => {
    const { container } = render(
      <PullRequestSidebar
        needsReview={[pr(5, 'Please look')]}
        mine={[]}
        others={[]}
        issues={[]}
        draftCounts={{}}
        prTasks={{}}
        issueTasks={{}}
        showing="pulls"
        activeNumber={null}
        activeIssue={null}
        loading={false}
        onShow={vi.fn()}
        onOpenPullRequest={vi.fn()}
        onOpenIssue={vi.fn()}
        onCreateTaskFromIssue={vi.fn()}
        onOpenTask={vi.fn()}
        width={415}
      />,
    );

    expect((container.firstChild as HTMLElement).style.width).toBe('415px');
  });
});

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
});
