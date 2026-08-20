import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { detectPullRequestsForProject, detectPullRequestForTask } from '../../services/githubTaskActions';

const PROJECT = '/project';

describe('background pull request detection', () => {
  beforeEach(() => {
    useProjectStore.getState().resetForProject();
    useAppStore.setState({ activeProjectPath: PROJECT });
    vi.clearAllMocks();
    vi.mocked(window.api.task.getAll).mockResolvedValue([]);
  });

  test('a link found for the active project refreshes the board', async () => {
    vi.mocked(window.api.github.detectProjectPrs).mockResolvedValue({ linked: 1 });
    vi.mocked(window.api.github.detectTaskPr).mockResolvedValue({ prNumber: 265 });

    await detectPullRequestsForProject(PROJECT);
    await detectPullRequestForTask(PROJECT, 1);

    expect(window.api.task.getAll).toHaveBeenCalledTimes(2);
    expect(window.api.task.getAll).toHaveBeenCalledWith(PROJECT);
  });

  test('a detection that lands after a project switch leaves the board alone', async () => {
    // Both detections are fire-and-forget, so either can land after the user
    // has moved on.
    const switchProject = () => useAppStore.setState({ activeProjectPath: '/other-project' });
    vi.mocked(window.api.github.detectProjectPrs).mockImplementation(async () => {
      switchProject();
      return { linked: 1 };
    });
    vi.mocked(window.api.github.detectTaskPr).mockImplementation(async () => {
      switchProject();
      return { prNumber: 265 };
    });

    await detectPullRequestsForProject(PROJECT);
    useAppStore.setState({ activeProjectPath: PROJECT });
    await detectPullRequestForTask(PROJECT, 1);

    expect(window.api.task.getAll).not.toHaveBeenCalled();
  });
});
