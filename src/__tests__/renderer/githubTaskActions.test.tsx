import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../stores/appStore';
import { detectPullRequestsForProject, detectPullRequestForTask } from '../../services/githubTaskActions';

const PROJECT = '/project';

describe('background pull request detection', () => {
  beforeEach(() => {
    useAppStore.setState({ activeProjectPath: PROJECT });
    vi.clearAllMocks();
    vi.mocked(window.api.task.getAll).mockResolvedValue([]);
  });

  test("a link found refreshes its project's tasks, even once the user has moved to another", async () => {
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

    expect(vi.mocked(window.api.task.getAll).mock.calls).toEqual([[PROJECT], [PROJECT]]);
  });
});
