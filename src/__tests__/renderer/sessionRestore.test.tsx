import { describe, test, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResumeBanner } from '../../components/ResumeBanner';
import { SNAPSHOT_KEY } from '../../types';

import { restoreSession, returnToLastAppView } from '../../components/terminal/sessionRestore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { addProjectTerminal } from '../../components/terminal/terminalActions';
import { useAppStore } from '../../stores/appStore';
import { stackFrom, useTerminalStore } from '../../stores/terminalStore';
import type { LastSessionSnapshot, Project, SnapshotTerminal } from '../../types';
import type { RestorableEntry } from '../../components/terminal/sessionRestore';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// restoreSession only needs addProjectTerminal as a spy and the snapshot-save
// suspend/resume hooks as no-ops — both pull xterm in for real otherwise.
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../components/terminal/sessionSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/terminal/sessionSnapshot')>()),
  suspendSnapshotSaves: vi.fn(),
  resumeSnapshotSaves: vi.fn(),
}));

const PROJECT = '/project';
const project: Project = { path: PROJECT, name: 'Project' } as Project;

function snapTerminal(over: Partial<SnapshotTerminal>): SnapshotTerminal {
  return {
    ptyId: 'p',
    projectPath: PROJECT,
    taskNumber: null,
    worktreePath: null,
    worktreeBranch: null,
    sandboxed: false,
    label: null,
    ordinalInProject: 0,
    isActiveInProject: false,
    ui: { planPath: null, webPreview: null, runner: null },
    ...over,
  };
}

function entry(over: Partial<RestorableEntry> & { source: SnapshotTerminal }): RestorableEntry {
  return {
    project,
    taskNumber: over.source.taskNumber,
    taskName: null,
    taskStatus: null,
    label: over.source.label,
    ordinalInProject: over.source.ordinalInProject,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
  useAppStore.setState({ projects: [project, { path: '/other', name: 'Other' }], viewByProject: {} });
  useAppStore.getState().select({ kind: 'none' });
});

describe('restoreSession', () => {
  test('spawns from the back of the recency order, so the front terminal ends up in front, with its label', async () => {
    const a = snapTerminal({ ptyId: 'a', label: 'Build', ordinalInProject: 0, recencyRank: 1 });
    const b = snapTerminal({
      ptyId: 'b',
      label: 'My Renamed Tab',
      taskNumber: 7,
      ordinalInProject: 1,
      isActiveInProject: true,
      recencyRank: 0,
    });
    const c = snapTerminal({ ptyId: 'c', label: 'Other', projectPath: '/other', recencyRank: 2 });
    const snapshot: LastSessionSnapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      activeProjectPath: null,
      terminals: [a, b, c],
    };

    await restoreSession(snapshot, [entry({ source: a }), entry({ source: b }), entry({ source: c })]);

    const calls = vi.mocked(addProjectTerminal).mock.calls;
    expect(calls.map((call) => call[2]?.label)).toEqual(['Other', 'Build', 'My Renamed Tab']);
    expect(calls[2][2]).toMatchObject({ taskId: 7, skipAutoHook: true });
    expect(calls.every((call) => !call[2]?.background)).toBe(true);
  });

  test('a terminal that was never renamed restores without a label override', async () => {
    const a = snapTerminal({ ptyId: 'a', label: null, taskNumber: 3, ordinalInProject: 0, isActiveInProject: true });
    const snapshot: LastSessionSnapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      activeProjectPath: null,
      terminals: [a],
    };

    await restoreSession(snapshot, [entry({ source: a })]);

    expect(vi.mocked(addProjectTerminal).mock.calls[0][2]).toMatchObject({ label: undefined, taskId: 3 });
  });

  test('each project goes back to its board or stack, with the terminals in it under the ids they came back with, and Chat if it was on screen', async () => {
    vi.mocked(addProjectTerminal).mockImplementation(async (projectPath, _run, options) => {
      useTerminalStore
        .getState()
        .addTerminal(projectPath, `new-${options?.label}`, { taskId: options?.taskId ?? null });
      return true;
    });
    const shell = snapTerminal({ ptyId: 'a', label: 'Build', recencyRank: 1 });
    const task = snapTerminal({ ptyId: 'b', label: 'Ship', taskNumber: 7, recencyRank: 0 });
    const closed = snapTerminal({ ptyId: 'c', label: 'Gone', projectPath: '/other', recencyRank: 2 });
    const snapshot: LastSessionSnapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      activeProjectPath: PROJECT,
      terminals: [shell, task, closed],
      views: {
        [PROJECT]: { stack: stackFrom(['shell:a', `task:7:${PROJECT}`]) },
        '/other': { page: 'board' },
        '/gone': { stack: 'shell:c' },
      },
    };

    await restoreSession(snapshot, [entry({ source: shell }), entry({ source: task })]);

    expect(useAppStore.getState().selection).toEqual({
      kind: 'terminal',
      projectPath: PROJECT,
      stack: stackFrom(['shell:new-Build', `task:7:${PROJECT}`]),
    });
    expect(useAppStore.getState().projectView('/other')).toEqual({
      kind: 'page',
      projectPath: '/other',
      page: 'board',
    });
    expect(useAppStore.getState().projectView('/gone')).toBeNull();

    // Quit on Chat, it comes back to Chat, with the projects' views still put back behind it; with Chat off, it can't.
    vi.mocked(window.api.globalSettings.get).mockImplementation(async (key: string) =>
      key === 'lastActiveView' ? JSON.stringify({ type: 'chat', page: 'chat' }) : undefined,
    );
    useHomeChatStore.getState().setEnabled(true);
    useAppStore.getState().select({ kind: 'none' });
    await restoreSession(snapshot, [entry({ source: shell }), entry({ source: task })]);
    expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'chat' });
    expect(useAppStore.getState().projectView(PROJECT)).toMatchObject({ kind: 'terminal' });
    useHomeChatStore.getState().setEnabled(false);
    await restoreSession(snapshot, [entry({ source: shell }), entry({ source: task })]);
    expect(useAppStore.getState().selection).toMatchObject({ kind: 'terminal', projectPath: PROJECT });
    // Dismissing the banner goes back to it too.
    useHomeChatStore.getState().setEnabled(true);
    useAppStore.getState().select({ kind: 'none' });
    await returnToLastAppView();
    expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'chat' });
  });
});

describe('the resume banner', () => {
  test('lists Chat with the terminals that come back, and returns to it when it was on screen', async () => {
    const snapshot: LastSessionSnapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      activeProjectPath: PROJECT,
      terminals: [snapTerminal({ ptyId: 'a', label: 'Build', recencyRank: 0 })],
    };
    vi.mocked(window.api.globalSettings.get).mockImplementation(async (key: string) =>
      key === SNAPSHOT_KEY
        ? JSON.stringify(snapshot)
        : key === 'lastActiveView'
          ? JSON.stringify({ type: 'chat', page: 'chat' })
          : undefined,
    );
    useHomeChatStore.setState({
      enabled: true,
      currentId: 'home-1',
      chats: [{ id: 'home-1', title: 'Plan the release', createdAt: '2026-11-15T00:00:00Z' }],
    });
    render(<ResumeBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show session details' }));
    expect(screen.getByRole('button', { name: 'Hide session details' }).textContent).toBe(
      'Chat and 1 terminal across 1 project',
    );
    expect(screen.getByText('Plan the release')).toBeTruthy();
    expect(screen.getByText('Build')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(useAppStore.getState().selection).toEqual({ kind: 'chat', page: 'chat' }));
    expect(addProjectTerminal).toHaveBeenCalledTimes(1);
  });
});
