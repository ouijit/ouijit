import { describe, test, expect, beforeEach } from 'vitest';
import {
  HOME_STACK,
  collectActiveTags,
  getActivePtyId,
  terminalMatchesTag,
  useTerminalStore,
  visibleStack,
} from '../stores/terminalStore';

const A = '/a';
const B = '/b';

const store = () => useTerminalStore.getState();
const stack = (key: string) => visibleStack(store(), key);

beforeEach(() => {
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
});

describe('the terminal stack', () => {
  test('orders by recency across views: new and activated terminals go in front, the one left sits behind', () => {
    store().addTerminal(A, 'a1', {});
    store().addTerminal(B, 'b1', {});
    store().addTerminal(A, 'a2', {});
    expect(stack(HOME_STACK)).toEqual(['a2', 'b1', 'a1']);
    expect(stack(A)).toEqual(['a2', 'a1']);

    store().activate('a1');
    expect(stack(HOME_STACK)).toEqual(['a1', 'a2', 'b1']);
    expect(getActivePtyId(A)).toBe('a1');
    expect(getActivePtyId(B)).toBe('b1');

    // In the background a terminal lands behind its project's front, wherever that is.
    store().addTerminal(B, 'b2', {}, { background: true });
    store().addTerminal('/c', 'c1', {}, { background: true });
    expect(stack(HOME_STACK)).toEqual(['a1', 'c1', 'a2', 'b1', 'b2']);
    expect(getActivePtyId(B)).toBe('b1');
    expect(getActivePtyId('/c')).toBe('c1');

    // Closing the active terminal promotes the next most recent.
    store().removeTerminal('a1');
    expect(getActivePtyId(HOME_STACK)).toBe('c1');
    expect(getActivePtyId(A)).toBe('a2');
    expect(store().activate('gone')).toBe(false);
  });

  test('a filter hides terminals without moving them, and activating a hidden one clears it', () => {
    store().addTerminal(A, 'plain', {});
    store().addTerminal(A, 'bug1', { tags: ['Bug'] });
    store().addTerminal(A, 'bug2', { tags: ['bug'] });
    store().activate('plain');
    expect(stack(A)).toEqual(['plain', 'bug2', 'bug1']);

    store().setTagFilter(A, 'BUG');
    store().setTagFilter(HOME_STACK, 'bug');
    expect(stack(A)).toEqual(['bug2', 'bug1']);
    expect(getActivePtyId(A)).toBe('bug2');

    store().setTagFilter(A, null);
    expect(stack(A)).toEqual(['plain', 'bug2', 'bug1']);

    store().setTagFilter(A, 'bug');
    store().activate('plain');
    expect(store().tagFilters).toEqual({});
    expect(stack(A)).toEqual(['plain', 'bug2', 'bug1']);

    expect(terminalMatchesTag(undefined, 'bug')).toBe(false);
    expect(collectActiveTags(['plain', 'bug1', 'bug2', 'missing'], store().displayStates)).toEqual(['Bug']);
  });

  test('a terminal replacing a loading slot keeps its place, and restored order fills the places it is given', () => {
    store().addTerminal(A, 'pending-1', { isLoading: true });
    store().addTerminal(A, 'a1', {});
    store().rekeyTerminal('pending-1', 'pty-real');
    expect(stack(A)).toEqual(['a1', 'pty-real']);
    expect(store().terminalsByProject[A]).toEqual(['pty-real', 'a1']);

    store().addTerminal(B, 'b1', {});
    store().restoreOrder(['pty-real', 'a1', 'not-here']);
    expect(stack(HOME_STACK)).toEqual(['b1', 'pty-real', 'a1']);

    store().clearProject(A);
    expect(stack(HOME_STACK)).toEqual(['b1']);
  });
});
