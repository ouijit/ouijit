import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

import { installVisitTracker } from '../../services/visitTracker';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore, DEFAULT_DISPLAY_STATE, type TerminalDisplayState } from '../../stores/terminalStore';
import { useUIStore } from '../../stores/uiStore';
import { useGithubStore } from '../../stores/githubStore';
import type { Project, TaskWithWorkspace } from '../../types';

/** Past the tracker's dwell window, so a settled view counts as visited. */
const DWELL = 1200;

const projectA: Project = { path: '/work/alpha', name: 'Alpha' };
const projectB: Project = { path: '/work/bravo', name: 'Bravo' };

function display(over: Partial<TerminalDisplayState> & { ptyId: string; projectPath: string }): TerminalDisplayState {
  return { ...DEFAULT_DISPLAY_STATE, ...over } as TerminalDisplayState;
}

const TASKS: Record<string, TaskWithWorkspace[]> = {
  [projectA.path]: [
    { taskNumber: 7, name: 'Seven', status: 'in_progress', createdAt: '', githubPrNumber: 42 } as TaskWithWorkspace,
  ],
  [projectB.path]: [],
};

let stop: () => void;

/** Every visit the tracker has persisted, in order. */
function written(): string[] {
  const calls = vi.mocked(window.api.globalSettings.set).mock.calls.filter(([k]) => k === 'ui:palette-frecency');
  const last = calls[calls.length - 1];
  return last ? Object.keys(JSON.parse(last[1] as string)) : [];
}

beforeEach(() => {
  vi.useFakeTimers();
  window.api.globalSettings.get = vi.fn().mockResolvedValue(undefined);
  window.api.globalSettings.set = vi.fn().mockResolvedValue({ success: true });

  useAppStore.setState({
    projects: [projectA, projectB],
    activeView: 'project',
    activeProjectPath: projectA.path,
    activeProjectData: projectA,
    taskCacheByProject: { ...TASKS },
  });
  useTerminalStore.setState({
    terminalsByProject: { [projectA.path]: ['alpha-1', 'alpha-7'] },
    displayStates: {
      'alpha-1': display({ ptyId: 'alpha-1', projectPath: projectA.path, label: 'Alpha shell' }),
      'alpha-7': display({ ptyId: 'alpha-7', projectPath: projectA.path, label: 'Seven', taskId: 7 }),
    },
    activeIndices: { [projectA.path]: 0 },
  });
  useProjectStore.setState({ kanbanVisible: true, activePanel: 'terminals' });
  useUIStore.setState({ homeActivePtyId: null });
  useGithubStore.setState({ projectPath: null, activeNumber: null });

  stop = installVisitTracker();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

/** Let the dwell elapse and the deferred write flush. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DWELL);
  await vi.advanceTimersByTimeAsync(500);
}

describe('visitTracker', () => {
  test('a board on screen is a visit to its project', async () => {
    await settle();
    expect(written()).toEqual([`project:${projectA.path}`]);
  });

  test('a foregrounded shell is a visit to the task that owns it', async () => {
    useProjectStore.setState({ kanbanVisible: false });
    useTerminalStore.setState({ activeIndices: { [projectA.path]: 1 } });
    await settle();
    // Keyed on the task, not the pty: the shell will not outlive the worktree,
    // but what this says about the task should.
    expect(written()).toEqual([`task:${projectA.path}#7`]);
  });

  test('a shell no task claims is a visit to the shell itself', async () => {
    useProjectStore.setState({ kanbanVisible: false });
    useTerminalStore.setState({ activeIndices: { [projectA.path]: 0 } });
    await settle();
    expect(written()).toEqual(['terminal:alpha-1']);
  });

  test('a pull request open in the panel is a visit to the task holding it', async () => {
    useProjectStore.setState({ kanbanVisible: false, activePanel: 'pull-requests' });
    useGithubStore.setState({ projectPath: projectA.path, activeNumber: 42 });
    await settle();
    expect(written()).toEqual([`task:${projectA.path}#7`]);
  });

  test('passing through a view on the way elsewhere is not a visit', async () => {
    await vi.advanceTimersByTimeAsync(DWELL / 3);
    useAppStore.setState({ activeProjectPath: projectB.path, activeProjectData: projectB });
    await settle();
    expect(written()).toEqual([`project:${projectB.path}`]);
  });

  test('staying put does not keep re-recording', async () => {
    await settle();
    useTerminalStore.setState({ displayStates: { ...useTerminalStore.getState().displayStates } });
    await settle();
    const calls = vi.mocked(window.api.globalSettings.set).mock.calls.filter(([k]) => k === 'ui:palette-frecency');
    expect(JSON.parse(calls[calls.length - 1][1] as string)[`project:${projectA.path}`].n).toBe(1);
  });
});
