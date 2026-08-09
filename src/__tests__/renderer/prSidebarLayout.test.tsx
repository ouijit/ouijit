import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { PullRequestSidebar } from '../../components/github/PullRequestSidebar';
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

function renderSidebar(overrides: Partial<React.ComponentProps<typeof PullRequestSidebar>> = {}) {
  const onCollapsedChange = vi.fn();
  const result = render(
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
      width={320}
      collapsed={false}
      onCollapsedChange={onCollapsedChange}
      {...overrides}
    />,
  );
  return { ...result, onCollapsedChange };
}

describe('PullRequestSidebar layout', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('it is as wide as it has been dragged to', () => {
    const { container } = renderSidebar({ width: 415 });
    expect((container.firstChild as HTMLElement).style.width).toBe('415px');
  });

  test('hiding the list asks for it to be hidden', () => {
    const { onCollapsedChange } = renderSidebar();

    fireEvent.click(screen.getByLabelText('Hide the list'));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  /**
   * The way back has to be on screen whatever else is. Everything to the right
   * of the list is conditional — a pull request, an issue, a spinner, an empty
   * state — so collapsing to nothing would mean closing what you had open could
   * leave no control anywhere that brings the list back.
   */
  test('collapsed, it still offers a way back', () => {
    const { onCollapsedChange } = renderSidebar({ collapsed: true });

    expect(screen.queryByPlaceholderText('Search pull requests')).toBeNull();
    expect(screen.queryByText('Please look')).toBeNull();

    fireEvent.click(screen.getByLabelText('Show the list'));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  test('collapsed, it still says how much is waiting', () => {
    renderSidebar({ collapsed: true, needsReview: [pr(5, 'One'), pr(6, 'Two')] });
    // A rail that said nothing would be a worse trade for the width it costs.
    expect(screen.getByText('2')).toBeTruthy();
  });
});
