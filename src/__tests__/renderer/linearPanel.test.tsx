import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import { PullRequestsPanel } from '../../components/github/PullRequestsPanel';
import { TitleBar } from '../../components/TitleBarReact';
import { useAppStore } from '../../stores/appStore';
import { useExperimentalStore } from '../../stores/experimentalStore';
import { useGithubStore } from '../../stores/githubStore';
import { useLinearStore } from '../../stores/linearStore';
import { usePanelStore } from '../../stores/panelStore';
import { useProjectStore } from '../../stores/projectStore';
import { DEFAULT_EXPERIMENTAL_FLAGS } from '../../experimentalFlags';
import { inbox, issue, issueList, detail } from './githubFixtures';
import { linearAvailability, linearDetail, linearGroups, linearIssue } from './linearFixtures';

const PROJECT = '/work/alpha';

describe('Linear in the Issues list', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useGithubStore.getState().reset();
    useLinearStore.getState().reset();
    usePanelStore.setState(usePanelStore.getInitialState());
    useGithubStore.setState({ projectPath: null });
    useLinearStore.setState({ projectPath: null });
    useProjectStore.setState({ tasks: [], toasts: [] });
    useAppStore.setState({ activeProjectData: { path: PROJECT, name: 'Alpha' } });

    vi.mocked(window.api.github.availability).mockResolvedValue({
      available: true,
      identity: { host: 'github.com', owner: 'o', repo: 'r' },
    });
    vi.mocked(window.api.github.inbox).mockResolvedValue(inbox());
    vi.mocked(window.api.github.issues).mockResolvedValue(issueList());
    vi.mocked(window.api.github.onDraftsChanged).mockReturnValue(() => {});
    vi.mocked(window.api.linear.onDraftsChanged).mockReturnValue(() => {});
    vi.mocked(window.api.lens.onChanged).mockReturnValue(() => {});
    vi.mocked(window.api.linear.availability).mockResolvedValue(linearAvailability());
    vi.mocked(window.api.linear.issues).mockResolvedValue(linearGroups());
  });

  /**
   * Gating the title bar on GitHub alone would ship a feature with no way to
   * open it: `linear` on and `github` off has a panel and no entry point.
   */
  test('the panel is reachable with Linear on and GitHub off', () => {
    useAppStore.setState({ activeProjectPath: PROJECT, activeView: 'project' });
    useExperimentalStore.setState({
      flagsByProject: { [PROJECT]: { ...DEFAULT_EXPERIMENTAL_FLAGS, github: false, linear: true } },
    });

    render(<TitleBar mode="project" />);

    expect(screen.getByLabelText('Pull requests')).toBeTruthy();
  });

  test('a project with only Linear connected sees Linear groups and no empty headings', async () => {
    vi.mocked(window.api.github.availability).mockResolvedValue({
      available: false,
      reason: 'gh-missing',
      message: 'The GitHub CLI is not installed.',
    });
    vi.mocked(window.api.linear.issues).mockResolvedValue(
      linearGroups({ assigned: [linearIssue({ identifier: 'ENG-231', title: 'Ship the thing' })] }),
    );

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));

    expect(await screen.findByText('Ship the thing')).toBeTruthy();
    expect(screen.getByText('ENG-231')).toBeTruthy();
    expect(screen.getByText('Assigned to you')).toBeTruthy();
    // Nothing GitHub could answer, so none of its headings render.
    expect(screen.queryByText('Open on o/r')).toBeNull();
    expect(screen.queryByText('Current cycle')).toBeNull();
  });

  test('with both connected, one Assigned to you holds rows from each', async () => {
    vi.mocked(window.api.github.issues).mockResolvedValue(
      issueList({
        assigned: [issue({ number: 299, title: 'A bug from outside', updatedAt: '2026-07-01T00:00:00.000Z' })],
        open: [issue({ number: 12, title: 'Something else' })],
      }),
    );
    vi.mocked(window.api.linear.issues).mockResolvedValue(
      linearGroups({
        assigned: [
          linearIssue({ identifier: 'ENG-231', title: 'Ship the thing', updatedAt: '2026-07-03T00:00:00.000Z' }),
        ],
      }),
    );

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));

    await screen.findByText('Ship the thing');
    const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings.filter((h) => h?.startsWith('Assigned to you'))).toHaveLength(1);
    expect(screen.getByText('#299')).toBeTruthy();
    expect(screen.getByText('ENG-231')).toBeTruthy();
    // #12 is the repo's, and belongs to the group below rather than to this one.
    expect(screen.getByText('Open on o/r')).toBeTruthy();
  });

  /**
   * One slot is what makes this hard to get wrong: opening anything replaces
   * whatever was there, across sources.
   */
  test('opening a Linear issue closes the pull request that was open', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [{ ...detail({ number: 5, title: 'Please look' }) }] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ number: 5, title: 'Please look' }));
    vi.mocked(window.api.linear.issues).mockResolvedValue(
      linearGroups({ assigned: [linearIssue({ identifier: 'ENG-231', title: 'Ship the thing' })] }),
    );
    vi.mocked(window.api.linear.issue).mockResolvedValue(linearDetail({ identifier: 'ENG-231' }));

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    await screen.findByText('Summary');
    expect(usePanelStore.getState().open).toEqual({ source: 'github-pr', number: 5 });

    fireEvent.click(screen.getByText('Issues'));
    fireEvent.click(await screen.findByText('Ship the thing'));

    await waitFor(() => {
      expect(usePanelStore.getState().open).toEqual({ source: 'linear', id: 'issue-ENG-231' });
    });
    expect(await screen.findByText('what needs doing')).toBeTruthy();
  });

  test('a project Linear cannot place asks once, in a row rather than a modal', async () => {
    vi.mocked(window.api.linear.availability).mockResolvedValue(
      linearAvailability({ scope: undefined, suggestedLabel: { id: 'label-1', name: 'o/r' } }),
    );
    vi.mocked(window.api.linear.setScope).mockResolvedValue({ success: true });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));

    expect(await screen.findByText('Linear issues from')).toBeTruthy();
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(window.api.linear.setScope).toHaveBeenCalledWith(PROJECT, {
        kind: 'repo-label',
        labelId: 'label-1',
        name: 'o/r',
      });
    });
  });
});
