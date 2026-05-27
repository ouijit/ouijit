import { describe, test, expect } from 'vitest';
import { parseOsc133Events, planOsc133Transitions } from '../components/terminal/osc133';

/**
 * Covers the state-machine rules that decide which transitions an OSC 133
 * event batch should drive on the terminal status dot. The planner is pure,
 * so we can pin the priority logic without standing up an OuijitTerminal.
 */

describe('planOsc133Transitions', () => {
  test(';C while ready enters running', () => {
    const events = parseOsc133Events('\x1b]133;C\x07');
    expect(planOsc133Transitions(events, 'ready')).toEqual([{ kind: 'enterRunning' }]);
  });

  test(';C while thinking is ignored (agent activity wins)', () => {
    const events = parseOsc133Events('\x1b]133;C\x07');
    expect(planOsc133Transitions(events, 'thinking')).toEqual([]);
  });

  test(';C while running is a no-op', () => {
    const events = parseOsc133Events('\x1b]133;C\x07');
    expect(planOsc133Transitions(events, 'running')).toEqual([]);
  });

  test(';C while success enters running (next command starts after a prior verdict)', () => {
    const events = parseOsc133Events('\x1b]133;C\x07');
    expect(planOsc133Transitions(events, 'success')).toEqual([{ kind: 'enterRunning' }]);
  });

  test(';A while running flips back to ready', () => {
    const events = parseOsc133Events('\x1b]133;A\x07');
    expect(planOsc133Transitions(events, 'running')).toEqual([{ kind: 'leaveRunning' }]);
  });

  test(';A while success is ignored (success/error verdict persists until next ;C)', () => {
    const events = parseOsc133Events('\x1b]133;A\x07');
    expect(planOsc133Transitions(events, 'success')).toEqual([]);
  });

  test(';A while error is ignored', () => {
    const events = parseOsc133Events('\x1b]133;A\x07');
    expect(planOsc133Transitions(events, 'error')).toEqual([]);
  });

  test(';A while thinking is ignored (agent activity wins)', () => {
    const events = parseOsc133Events('\x1b]133;A\x07');
    expect(planOsc133Transitions(events, 'thinking')).toEqual([]);
  });

  test(';A while ready is a no-op', () => {
    const events = parseOsc133Events('\x1b]133;A\x07');
    expect(planOsc133Transitions(events, 'ready')).toEqual([]);
  });

  test(';D always fires regardless of current state', () => {
    const events = parseOsc133Events('\x1b]133;D;0\x07');
    expect(planOsc133Transitions(events, 'thinking')).toEqual([{ kind: 'exit', code: 0 }]);
    expect(planOsc133Transitions(events, 'running')).toEqual([{ kind: 'exit', code: 0 }]);
    expect(planOsc133Transitions(events, 'ready')).toEqual([{ kind: 'exit', code: 0 }]);
  });

  test('full command cycle in one batch: ;C ;D;0 ;A from a ready start', () => {
    const events = parseOsc133Events('\x1b]133;C\x07output\x1b]133;D;0\x07\x1b]133;A\x07');
    // ;C → enterRunning; ;D;0 lands on success; ;A is ignored from success.
    expect(planOsc133Transitions(events, 'ready')).toEqual([{ kind: 'enterRunning' }, { kind: 'exit', code: 0 }]);
  });

  test('full command cycle ending in failure: ;C ;D;1 ;A leaves error visible', () => {
    const events = parseOsc133Events('\x1b]133;C\x07\x1b]133;D;1\x07\x1b]133;A\x07');
    expect(planOsc133Transitions(events, 'ready')).toEqual([{ kind: 'enterRunning' }, { kind: 'exit', code: 1 }]);
  });

  test('two commands in one batch produce two enterRunning/exit pairs', () => {
    const events = parseOsc133Events(
      '\x1b]133;C\x07\x1b]133;D;0\x07\x1b]133;A\x07\x1b]133;C\x07\x1b]133;D;0\x07\x1b]133;A\x07',
    );
    // After first ;D;0 the planner treats state as success, so the next ;C still re-enters running.
    expect(planOsc133Transitions(events, 'ready')).toEqual([
      { kind: 'enterRunning' },
      { kind: 'exit', code: 0 },
      { kind: 'enterRunning' },
      { kind: 'exit', code: 0 },
    ]);
  });

  test('empty event list produces no transitions', () => {
    expect(planOsc133Transitions([], 'ready')).toEqual([]);
  });
});
