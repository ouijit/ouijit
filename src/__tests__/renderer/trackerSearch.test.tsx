import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import { PullRequestsPanel } from '../../components/github/PullRequestsPanel';
import { useAppStore } from '../../stores/appStore';
import { useGithubStore } from '../../stores/githubStore';
import { useLinearStore } from '../../stores/linearStore';
import { usePanelStore } from '../../stores/panelStore';
import { useProjectStore } from '../../stores/projectStore';
import { inbox, issue, issueDetail, issueList, pr } from './githubFixtures';
import { linearAvailability, linearGroups, linearIssue } from './linearFixtures';

const PROJECT = '/work/alpha';

function headings(): string[] {
  return [...document.querySelectorAll('h2')].map((h) => h.textContent ?? '');
}

describe('finding what the list does not hold', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useGithubStore.getState().reset();
    useLinearStore.getState().reset();
    usePanelStore.setState(usePanelStore.getInitialState());
    useGithubStore.setState({ projectPath: null });
    useLinearStore.setState({ projectPath: null });
    useProjectStore.setState({ toasts: [] });
    useAppStore.setState({ activeProjectData: { path: PROJECT, name: 'Alpha' } });

    vi.mocked(window.api.github.availability).mockResolvedValue({
      available: true,
      identity: { host: 'github.com', owner: 'o', repo: 'r' },
    });
    vi.mocked(window.api.github.onDraftsChanged).mockReturnValue(() => {});
    vi.mocked(window.api.linear.onDraftsChanged).mockReturnValue(() => {});
    vi.mocked(window.api.lens.onChanged).mockReturnValue(() => {});
    vi.mocked(window.api.github.inbox).mockResolvedValue(inbox());
    vi.mocked(window.api.github.issues).mockResolvedValue(issueList());
    vi.mocked(window.api.linear.availability).mockResolvedValue(linearAvailability());
    vi.mocked(window.api.linear.issues).mockResolvedValue(linearGroups());
  });

  test('pull requests page past the first fifty, and a search finds the ones no page holds', async () => {
    vi.mocked(window.api.github.inbox).mockImplementation(async (_project, after) =>
      after === 'cursor-1'
        ? inbox({ others: [pr({ number: 2, title: 'Second page' }), pr({ number: 1, title: 'First page' })] })
        : inbox({ others: [pr({ number: 1, title: 'First page' })], next: 'cursor-1' }),
    );
    vi.mocked(window.api.github.searchPullRequests).mockResolvedValue([
      pr({ number: 1, title: 'First page' }),
      pr({ number: 90, title: 'Merged long ago', state: 'merged' }),
    ]);

    render(<PullRequestsPanel projectPath={PROJECT} />);
    await screen.findByText('First page');

    fireEvent.click(screen.getByText('Show more'));
    expect(await screen.findByText('Second page')).toBeTruthy();
    expect(window.api.github.inbox).toHaveBeenLastCalledWith(PROJECT, 'cursor-1');
    // The overlap between pages is shown once, and the last page offers no more.
    expect(screen.getAllByText('First page')).toHaveLength(1);
    expect(screen.queryByText('Show more')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Search pull requests'), { target: { value: 'long ago' } });
    expect(await screen.findByText('Searching…')).toBeTruthy();
    expect(await screen.findByText('Merged long ago')).toBeTruthy();
    expect(window.api.github.searchPullRequests).toHaveBeenCalledWith(PROJECT, 'long ago');
    expect(headings()).toContain('More results');
    // #1 matched on GitHub's side but not on the text here, so it is a result rather than hidden in both.
    expect(screen.getAllByText('First page')).toHaveLength(1);

    fireEvent.click(screen.getByText('Merged long ago'));
    await waitFor(() => expect(usePanelStore.getState().open).toEqual({ source: 'github-pr', number: 90 }));
  });

  test('issues search both trackers, and Assigned to you pages both', async () => {
    vi.mocked(window.api.github.issues).mockImplementation(async (_project, page) =>
      page
        ? issueList({ assigned: [issue({ number: 7, title: 'Later GitHub issue' })] })
        : issueList({ assigned: [issue({ number: 3, title: 'Mine on GitHub' })], assignedNext: 'gh-cursor' }),
    );
    vi.mocked(window.api.linear.issues).mockResolvedValue(
      linearGroups({
        started: [linearIssue({ identifier: 'ENG-1', title: 'Already started' })],
        assigned: [linearIssue({ identifier: 'ENG-2', title: 'Mine on Linear' })],
        next: { triage: null, started: null, assigned: 'lin-cursor', cycle: null },
      }),
    );
    vi.mocked(window.api.linear.issuePage).mockResolvedValue({
      // ENG-1 is In progress already; a later page of another group must not repeat it.
      issues: [
        linearIssue({ identifier: 'ENG-1', title: 'Already started' }),
        linearIssue({ identifier: 'ENG-9', title: 'Later Linear issue' }),
      ],
      next: null,
    });
    vi.mocked(window.api.github.searchIssues).mockResolvedValue([
      issue({ number: 400, title: 'Closed GitHub bug', state: 'closed' }),
    ]);
    vi.mocked(window.api.linear.search).mockResolvedValue([linearIssue({ identifier: 'ENG-77', title: 'Linear bug' })]);

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));
    await screen.findByText('Mine on Linear');

    fireEvent.click(screen.getByText('Show more'));
    expect(await screen.findByText('Later GitHub issue')).toBeTruthy();
    expect(await screen.findByText('Later Linear issue')).toBeTruthy();
    expect(window.api.github.issues).toHaveBeenLastCalledWith(PROJECT, { group: 'assigned', after: 'gh-cursor' });
    expect(window.api.linear.issuePage).toHaveBeenCalledWith(PROJECT, 'assigned', 'lin-cursor');
    expect(screen.getAllByText('Already started')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText('Show more')).toBeNull());

    fireEvent.change(screen.getByPlaceholderText('Search issues'), { target: { value: 'bug' } });
    expect(await screen.findByText('Closed GitHub bug')).toBeTruthy();
    expect(screen.getByText('Linear bug')).toBeTruthy();
    expect(window.api.linear.search).toHaveBeenCalledWith(PROJECT, 'bug');
  });

  test('a task being made from an issue says so wherever the issue shows, until it exists', async () => {
    let finish!: (result: { success: boolean; taskNumber: number }) => void;
    vi.mocked(window.api.github.taskFromIssue).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    vi.mocked(window.api.github.issues).mockResolvedValue(
      issueList({ open: [issue({ number: 12, title: 'Make me a task' })] }),
    );

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));
    await screen.findByText('Make me a task');

    fireEvent.click(screen.getByText('Create task'));
    expect(await screen.findByText('Creating task…')).toBeTruthy();
    expect(screen.queryByText('Create task')).toBeNull();

    // Opened while it is being made, the issue offers no second button either.
    vi.mocked(window.api.github.issue).mockResolvedValue(issueDetail({ number: 12, title: 'Make me a task' }));
    fireEvent.click(screen.getByText('Make me a task'));
    await waitFor(() => expect(screen.getAllByText('Creating task…')).toHaveLength(2));
    expect(screen.queryByText('Create task')).toBeNull();
    expect(window.api.github.taskFromIssue).toHaveBeenCalledTimes(1);

    finish({ success: true, taskNumber: 31 });
    await waitFor(() => expect(screen.queryByText('Creating task…')).toBeNull());
    expect(usePanelStore.getState().creating).toEqual([]);
  });
});
