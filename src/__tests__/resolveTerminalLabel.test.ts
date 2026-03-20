import { describe, test, expect } from 'vitest';

import { resolveTerminalLabel } from '../components/terminal/terminalReact';

describe('resolveTerminalLabel', () => {
  test('priority: task name > branch > fallback > Shell', () => {
    // Task name wins when present
    expect(resolveTerminalLabel('My Task', 'my-task-1234567890', 'Build')).toBe('My Task');
    // Falls back to formatted branch (strips timestamp suffix)
    expect(resolveTerminalLabel(null, 'my-task-1234567890')).toBe('my task');
    // Falls back to explicit fallback
    expect(resolveTerminalLabel(null, undefined, 'Build')).toBe('Build');
    // Defaults to Shell
    expect(resolveTerminalLabel(null, undefined)).toBe('Shell');
  });

  test('falsy task names (empty string, undefined) fall through', () => {
    expect(resolveTerminalLabel('', 'feat-1234567890')).toBe('feat');
    expect(resolveTerminalLabel(undefined, 'feat-1234567890')).toBe('feat');
  });
});
