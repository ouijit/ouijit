import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getActivePtyId,
  isUnread,
  stackMembers,
  stackOf,
  useTerminalStore,
  viewedPtyId,
} from '../stores/terminalStore';

const A = '/a';
const B = '/b';

const store = () => useTerminalStore.getState();
const task = (projectPath: string, taskId: number) => stackOf({ ptyId: '', projectPath, taskId });
const shell = (ptyId: string) => stackOf({ ptyId, projectPath: '', taskId: null });
const stack = (key: string) => stackMembers(store(), key);

beforeEach(() => {
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
});

describe('the terminal stack', () => {
  test("a task's terminals share a stack in recency order, and a shell is a stack of its own", () => {
    store().addTerminal(A, 'a1', { taskId: 1 });
    store().addTerminal(B, 'b1', { taskId: 1 });
    store().addTerminal(A, 'a2', { taskId: 1 });
    store().addTerminal(A, 'sh', {});
    expect(store().order).toEqual(['sh', 'a2', 'b1', 'a1']);
    expect(stack(task(A, 1))).toEqual(['a2', 'a1']);
    expect(stack(task(B, 1))).toEqual(['b1']);
    expect(stack(shell('sh'))).toEqual(['sh']);

    store().activate('a1');
    expect(getActivePtyId(task(A, 1))).toBe('a1');
    expect(store().order[0]).toBe('a1');

    // In the background a terminal lands behind its project's front, wherever that is.
    store().addTerminal(B, 'b2', { taskId: 1 }, { background: true });
    store().addTerminal('/c', 'c1', {}, { background: true });
    expect(store().order).toEqual(['a1', 'c1', 'sh', 'a2', 'b1', 'b2']);
    expect(getActivePtyId(task(B, 1))).toBe('b1');

    // Closing the active terminal promotes the next most recent.
    store().removeTerminal('a1');
    expect(getActivePtyId(task(A, 1))).toBe('a2');
    expect(store().activate('gone')).toBe(false);
  });

  test('a terminal replacing a loading slot keeps its place, and restored order fills the places it is given', () => {
    store().addTerminal(A, 'pending-1', { taskId: 2, isLoading: true });
    store().addTerminal(A, 'a1', { taskId: 2 });
    store().rekeyTerminal('pending-1', 'pty-real');
    expect(stack(task(A, 2))).toEqual(['a1', 'pty-real']);
    expect(store().terminalsByProject[A]).toEqual(['pty-real', 'a1']);

    store().addTerminal(B, 'b1', {});
    store().restoreOrder(['pty-real', 'a1', 'not-here']);
    expect(store().order).toEqual(['b1', 'pty-real', 'a1']);

    store().clearProject(A);
    expect(store().order).toEqual(['b1']);
  });

  describe('viewing', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(() => vi.useRealTimers());

    const at = (ms: number) => vi.setSystemTime(ms);
    const display = (ptyId: string) => store().displayStates[ptyId];
    const unread = (ptyId: string) => isUnread(display(ptyId), viewedPtyId(store()));
    const finish = (ptyId: string, status: 'ready' | 'success' = 'ready') => store().updateDisplay(ptyId, { status });

    test('a terminal is stamped as viewed when it is left, so only what finished while away is unread', () => {
      at(1000);
      store().addTerminal(A, 'a1', { status: 'thinking', taskId: 1 });
      store().addTerminal(A, 'a2', { status: 'thinking', taskId: 1 });
      store().addTerminal(B, 'b1', { status: 'thinking' }, { background: true });
      expect(display('a1')).toMatchObject({ statusSince: 1000, lastViewedAt: 1000 });
      store().setViewedStack(task(A, 1));
      expect(viewedPtyId(store())).toBe('a2');

      at(2000);
      finish('a2');
      finish('a1');
      expect(unread('a2')).toBe(false);
      expect(unread('a1')).toBe(true);

      // Switching terminals stamps the one left; the one arrived at is read while on screen.
      at(3000);
      store().activate('a1');
      expect(display('a2').lastViewedAt).toBe(3000);
      expect(display('a1').lastViewedAt).toBe(1000);
      expect(unread('a2')).toBe(false);
      expect(unread('a1')).toBe(false);

      at(4000);
      store().setViewedStack(shell('b1'));
      expect(display('a1').lastViewedAt).toBe(4000);
      expect(unread('a1')).toBe(false);

      at(5000);
      store().setWindowFocused(false);
      expect(viewedPtyId(store())).toBeUndefined();
      expect(display('b1').lastViewedAt).toBe(5000);

      at(6000);
      finish('b1');
      finish('a2', 'success');
      expect(unread('b1')).toBe(true);
      expect(unread('a2')).toBe(false);

      // Coming back marks it read only once it is left again.
      at(7000);
      store().setWindowFocused(true);
      expect(unread('b1')).toBe(false);
      expect(display('b1').lastViewedAt).toBe(5000);
      store().setViewedStack(null);
      expect(display('b1').lastViewedAt).toBe(7000);
      expect(unread('b1')).toBe(false);
    });
  });
});
