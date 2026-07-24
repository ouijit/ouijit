import { describe, test, expect, beforeEach } from 'vitest';
import {
  useTerminalStore,
  terminalMatchesTag,
  collectActiveTags,
  getVisibleTerminals,
} from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { DEFAULT_DISPLAY_STATE, type TerminalDisplayState } from '../../stores/terminalDisplay';

function display(ptyId: string, projectPath: string, tags: string[]): TerminalDisplayState {
  return { ...DEFAULT_DISPLAY_STATE, ptyId, projectPath, tags };
}

const PROJECT = '/project';

describe('tag filtering helpers', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      displayStates: {
        a: display('a', PROJECT, ['bug']),
        b: display('b', PROJECT, ['Feature']),
        c: display('c', PROJECT, []),
        d: display('d', PROJECT, ['bug']),
      },
      terminalsByProject: { [PROJECT]: ['a', 'b', 'c', 'd'] },
      activeIndices: { [PROJECT]: 0 },
    });
    useProjectStore.setState({ tagFilter: null });
  });

  test('terminalMatchesTag: null tag matches all, missing display never matches, case-insensitive', () => {
    const states = useTerminalStore.getState().displayStates;
    expect(terminalMatchesTag(states.a, null)).toBe(true);
    expect(terminalMatchesTag(undefined, 'bug')).toBe(false);
    expect(terminalMatchesTag(states.b, 'feature')).toBe(true); // 'Feature' vs 'feature'
    expect(terminalMatchesTag(states.a, 'feature')).toBe(false);
    expect(terminalMatchesTag(states.c, 'bug')).toBe(false); // no tags
  });

  test('collectActiveTags: distinct, case-folded, first-seen casing, skips unknown ids', () => {
    const states = useTerminalStore.getState().displayStates;
    expect(collectActiveTags(['a', 'b', 'c', 'd', 'missing'], states)).toEqual(['bug', 'Feature']);
    expect(collectActiveTags([], states)).toEqual([]);
  });

  test('getVisibleTerminals: no filter returns full list; a filter narrows it', () => {
    expect(getVisibleTerminals(PROJECT)).toEqual(['a', 'b', 'c', 'd']);

    useProjectStore.setState({ tagFilter: 'bug' });
    expect(getVisibleTerminals(PROJECT)).toEqual(['a', 'd']);

    useProjectStore.setState({ tagFilter: 'FEATURE' }); // case-insensitive
    expect(getVisibleTerminals(PROJECT)).toEqual(['b']);

    useProjectStore.setState({ tagFilter: 'nonexistent' });
    expect(getVisibleTerminals(PROJECT)).toEqual([]);
  });
});
