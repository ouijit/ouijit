import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// restoreSession only needs addProjectTerminal as a spy and the snapshot-save
// suspend/resume hooks as no-ops — both pull xterm in for real otherwise.
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../components/terminal/sessionSnapshot', () => ({
  suspendSnapshotSaves: vi.fn(),
  resumeSnapshotSaves: vi.fn(),
}));

import { restoreSession } from '../../components/terminal/sessionRestore';
import { addProjectTerminal } from '../../components/terminal/terminalActions';
import type { LastSessionSnapshot, Project, SnapshotTerminal } from '../../types';
import type { RestorableEntry } from '../../components/terminal/sessionRestore';

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
});

describe('restoreSession', () => {
  test('passes the persisted custom label and active flag through to addProjectTerminal', async () => {
    const a = snapTerminal({ ptyId: 'a', label: 'Build', ordinalInProject: 0, isActiveInProject: false });
    const b = snapTerminal({
      ptyId: 'b',
      label: 'My Renamed Tab',
      taskNumber: 7,
      ordinalInProject: 1,
      isActiveInProject: true,
    });
    const snapshot: LastSessionSnapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      activeProjectPath: null,
      terminals: [a, b],
    };

    await restoreSession(snapshot, [entry({ source: a }), entry({ source: b })]);

    expect(addProjectTerminal).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(addProjectTerminal).mock.calls;
    // Spawned in ordinal order: 'Build' (background, not active) then the renamed task tab (foreground).
    expect(calls[0][2]).toMatchObject({ label: 'Build', background: true });
    expect(calls[1][2]).toMatchObject({ label: 'My Renamed Tab', taskId: 7, background: false });
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
});
