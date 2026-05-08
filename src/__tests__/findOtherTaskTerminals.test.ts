import { describe, test, expect } from 'vitest';
import { findOtherTaskTerminals } from '../components/terminal/findOtherTaskTerminals';
import type { TerminalDisplayState } from '../stores/terminalStore';

const PROJECT = '/path/to/project';
const OTHER_PROJECT = '/path/to/other';

function makeDisplay(ptyId: string, patch: Partial<TerminalDisplayState>): TerminalDisplayState {
  return {
    ptyId,
    label: '',
    summary: '',
    summaryType: 'ready',
    gitFileStatus: null,
    lastOscTitle: '',
    tags: [],
    hookStatus: null,
    runnerStatus: 'idle',
    runnerScriptName: null,
    runnerPanelOpen: false,
    runnerFullWidth: true,
    diffPanelOpen: false,
    diffPanelSelectedFile: null,
    diffPanelMode: 'uncommitted',
    planPath: null,
    planPanelOpen: false,
    planFullWidth: true,
    webPreviewUrl: null,
    webPreviewPanelOpen: false,
    webPreviewFullWidth: true,
    sandboxed: false,
    taskId: null,
    worktreeBranch: null,
    projectPath: PROJECT,
    exited: false,
    isLoading: false,
    ...patch,
  } as TerminalDisplayState;
}

describe('findOtherTaskTerminals', () => {
  test('returns siblings on the same task, excluding self', () => {
    const displayStates = {
      a: makeDisplay('a', { taskId: 1 }),
      b: makeDisplay('b', { taskId: 1 }),
      c: makeDisplay('c', { taskId: 1 }),
    };
    const terminalsByProject = { [PROJECT]: ['a', 'b', 'c'] };

    expect(findOtherTaskTerminals(terminalsByProject, displayStates, PROJECT, 1, 'b')).toEqual(['a', 'c']);
  });

  test('skips terminals attached to other tasks', () => {
    const displayStates = {
      a: makeDisplay('a', { taskId: 1 }),
      b: makeDisplay('b', { taskId: 2 }),
      c: makeDisplay('c', { taskId: 1 }),
    };
    const terminalsByProject = { [PROJECT]: ['a', 'b', 'c'] };

    expect(findOtherTaskTerminals(terminalsByProject, displayStates, PROJECT, 1, 'a')).toEqual(['c']);
  });

  test('skips loading placeholders', () => {
    const displayStates = {
      a: makeDisplay('a', { taskId: 1 }),
      b: makeDisplay('b', { taskId: 1, isLoading: true }),
    };
    const terminalsByProject = { [PROJECT]: ['a', 'b'] };

    expect(findOtherTaskTerminals(terminalsByProject, displayStates, PROJECT, 1, 'a')).toEqual([]);
  });

  test('skips terminals without a taskId', () => {
    const displayStates = {
      a: makeDisplay('a', { taskId: 1 }),
      b: makeDisplay('b', { taskId: null }),
    };
    const terminalsByProject = { [PROJECT]: ['a', 'b'] };

    expect(findOtherTaskTerminals(terminalsByProject, displayStates, PROJECT, 1, 'a')).toEqual([]);
  });

  test('ignores terminals from other projects', () => {
    const displayStates = {
      a: makeDisplay('a', { taskId: 1 }),
      x: makeDisplay('x', { taskId: 1, projectPath: OTHER_PROJECT }),
    };
    const terminalsByProject = { [PROJECT]: ['a'], [OTHER_PROJECT]: ['x'] };

    expect(findOtherTaskTerminals(terminalsByProject, displayStates, PROJECT, 1, 'a')).toEqual([]);
  });

  test('returns empty when project has no terminals', () => {
    expect(findOtherTaskTerminals({}, {}, PROJECT, 1, 'a')).toEqual([]);
  });

  test('tolerates missing displayState entries', () => {
    const terminalsByProject = { [PROJECT]: ['ghost', 'a'] };
    const displayStates = { a: makeDisplay('a', { taskId: 1 }) };

    expect(findOtherTaskTerminals(terminalsByProject, displayStates, PROJECT, 1, 'a')).toEqual([]);
  });
});
