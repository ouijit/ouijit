import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import { PullRequestsPanel } from '../../components/github/PullRequestsPanel';
import { LinearScopeSection } from '../../components/linear/LinearScopeSection';
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

    // The other tab is the empty one, and says why rather than reading as
    // "no open pull requests".
    fireEvent.click(screen.getByText('Pull requests'));
    expect(await screen.findByText('The GitHub CLI is not installed.')).toBeTruthy();
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

    expect(await screen.findByText('Show Linear issues from')).toBeTruthy();
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(window.api.linear.setScope).toHaveBeenCalledWith(PROJECT, {
        kind: 'repo-label',
        labelId: 'label-1',
        name: 'o/r',
      });
    });
  });

  /**
   * The label matched from the remote is a suggestion, not a verdict: a
   * workspace can label a repo under a name that is not its own.
   */
  test('the pre-filled answer can be changed without leaving the row', async () => {
    vi.mocked(window.api.linear.availability).mockResolvedValue(
      linearAvailability({ scope: undefined, suggestedLabel: { id: 'label-1', name: 'o/r' } }),
    );
    vi.mocked(window.api.linear.setScope).mockResolvedValue({ success: true });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));

    // The trigger reads the matched label; the menu holds the teams beside it.
    fireEvent.click(await screen.findByRole('button', { expanded: false, name: /o\/r/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Engineering/ }));
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(window.api.linear.setScope).toHaveBeenCalledWith(PROJECT, {
        kind: 'team',
        teamId: 'team-1',
        name: 'Engineering',
      });
    });
  });
});

describe('the state control', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useGithubStore.getState().reset();
    useLinearStore.getState().reset();
    usePanelStore.setState(usePanelStore.getInitialState());
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
    vi.mocked(window.api.linear.issues).mockResolvedValue(
      linearGroups({ assigned: [linearIssue({ identifier: 'ENG-231', title: 'Ship the thing' })] }),
    );
    vi.mocked(window.api.linear.issue).mockResolvedValue(linearDetail({ identifier: 'ENG-231' }));
    vi.mocked(window.api.linear.moveIssue).mockResolvedValue({ success: true });
  });

  /** The one Linear write outside comments, and the way out of Triage. */
  test('moves the issue through its team workflow', async () => {
    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));
    fireEvent.click(await screen.findByText('Ship the thing'));

    // The chrome names the state it is in, as the Review and Merge menus do.
    fireEvent.click(await screen.findByRole('button', { expanded: false, name: /Todo/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /In Progress/ }));

    await waitFor(() => {
      expect(window.api.linear.moveIssue).toHaveBeenCalledWith(PROJECT, 'issue-ENG-231', 'state-2');
    });
    // The groups are membership in a state, so the row moved too — without
    // this the sidebar stayed as it was until the project was left and reopened.
    await waitFor(() => {
      expect(window.api.linear.issues).toHaveBeenCalledTimes(2);
    });
  });
});

describe('changing the answer afterwards', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useLinearStore.getState().reset();
    useProjectStore.setState({ tasks: [], toasts: [] });
    useExperimentalStore.setState({
      flagsByProject: { [PROJECT]: { ...DEFAULT_EXPERIMENTAL_FLAGS, linear: true } },
    });
    vi.mocked(window.api.linear.availability).mockResolvedValue(linearAvailability());
    vi.mocked(window.api.linear.setScope).mockResolvedValue({ success: true });
  });

  /**
   * The connect row disappears the moment it is answered, so without this the
   * answer could be given once and never taken back.
   */
  test('project settings can point the project at something else, or at nothing', async () => {
    render(<LinearScopeSection projectPath={PROJECT} />);

    fireEvent.click(await screen.findByRole('button', { expanded: false, name: /o\/r/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Engineering/ }));

    await waitFor(() => {
      expect(window.api.linear.setScope).toHaveBeenCalledWith(PROJECT, {
        kind: 'team',
        teamId: 'team-1',
        name: 'Engineering',
      });
    });

    fireEvent.click(screen.getByText('Disconnect'));
    await waitFor(() => {
      expect(window.api.linear.setScope).toHaveBeenLastCalledWith(PROJECT, null);
    });
  });

  /**
   * The wall is a project with no usable key, and it is hit here — so the field
   * is here, rather than a sentence pointing at another panel.
   */
  test('with no key, the field to paste one is in the row that needs it', async () => {
    vi.mocked(window.api.linear.availability).mockResolvedValue({
      connected: false,
      reason: 'no-credential',
      repoLabels: [],
      teams: [],
    });
    vi.mocked(window.api.linear.setCredential).mockResolvedValue({ success: true });

    render(<LinearScopeSection projectPath={PROJECT} />);

    const field = await screen.findByPlaceholderText('lin_api_…');
    fireEvent.change(field, { target: { value: 'lin_api_project' } });
    fireEvent.click(screen.getByText('Save'));

    // Stored against the project, so the app-wide key is left alone.
    await waitFor(() => {
      expect(window.api.linear.setCredential).toHaveBeenCalledWith('lin_api_project', PROJECT);
    });
    expect(screen.queryByText('Disconnect')).toBeNull();
  });

  /**
   * A key reads one workspace, so a project in a second one keeps its own. Most
   * do not, and theirs must be the app's rather than a copy of it.
   */
  test('a project on the app-wide key can take one of its own, and give it back', async () => {
    vi.mocked(window.api.linear.availability).mockResolvedValue(linearAvailability({ source: 'app' }));
    vi.mocked(window.api.linear.setCredential).mockResolvedValue({ success: true });

    render(<LinearScopeSection projectPath={PROJECT} />);

    // Unmistakably a key that is set, and where it applies.
    expect(await screen.findByText('lin_api_••••4f2a')).toBeTruthy();
    expect(screen.getByText(/Shared with every project/)).toBeTruthy();
    fireEvent.click(screen.getByText('Use a different API key for this project'));
    fireEvent.change(screen.getByPlaceholderText('lin_api_…'), { target: { value: 'lin_api_client' } });
    // What the row reads back after saving: the project now has its own.
    vi.mocked(window.api.linear.availability).mockResolvedValue(linearAvailability({ source: 'project' }));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(window.api.linear.setCredential).toHaveBeenCalledWith('lin_api_client', PROJECT);
    });

    // Handing it back is the empty string against this project, which falls
    // through to the app's again.
    fireEvent.click(await screen.findByText('Use the shared API key'));

    await waitFor(() => {
      expect(window.api.linear.setCredential).toHaveBeenLastCalledWith('', PROJECT);
    });
  });
});
