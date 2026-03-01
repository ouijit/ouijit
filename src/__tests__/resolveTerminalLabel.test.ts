import { describe, test, expect, vi } from 'vitest';

// Provide browser globals that transitive imports reference at load time
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = { addEventListener: () => {} };
}
if (typeof globalThis.navigator?.userAgent === 'undefined') {
  (globalThis as any).navigator = { ...globalThis.navigator, userAgent: '', platform: 'MacIntel' };
}

// Mock browser-only modules that terminalCards.ts imports at load time
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('hotkeys-js', () => ({ default: Object.assign(() => {}, { filter: true, setScope: () => {}, getScope: () => '', deleteScope: () => {}, unbind: () => {} }) }));
vi.mock('../utils/icons', () => ({ convertIconsIn: () => {} }));
vi.mock('../components/importDialog', () => ({ showToast: () => {} }));
vi.mock('../components/hookConfigDialog', () => ({ showHookConfigDialog: () => {} }));

import { resolveTerminalLabel } from '../components/project/terminalCards';

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
