import { describe, test, expect } from 'vitest';
import { DEFAULT_DISPLAY_STATE } from '../stores/terminalDisplay';
import type { TerminalDisplayState } from '../stores/terminalDisplay';

// summaryType is part of the public terminal display state shape. The status
// state machine itself lives inside OuijitTerminal (terminalReact.ts) and is
// covered by the integration-leaning tests; here we pin the *type* so a
// future widening or removal of a state is intentional.

describe('TerminalDisplayState.summaryType', () => {
  test('accepts the four documented states', () => {
    const values: TerminalDisplayState['summaryType'][] = ['thinking', 'ready', 'success', 'error'];
    expect(values).toEqual(['thinking', 'ready', 'success', 'error']);
  });

  test('defaults to ready', () => {
    expect(DEFAULT_DISPLAY_STATE.summaryType).toBe('ready');
  });
});
