import { describe, test, expect } from 'vitest';
import { isAllowedKey } from '../ipc/handlers/settings';

describe('settings IPC allowed keys', () => {
  test('allows the ready-audio toggle key', () => {
    expect(isAllowedKey('disableReadyAudio')).toBe(true);
  });

  test('allows existing exact-match keys', () => {
    expect(isAllowedKey('disableUpdates')).toBe(true);
    expect(isAllowedKey('lastActiveView')).toBe(true);
  });

  test('allows prefixed namespaces', () => {
    expect(isAllowedKey('terminal:font-size')).toBe(true);
    expect(isAllowedKey('ui:sidebar-pinned')).toBe(true);
  });

  test('rejects unknown keys', () => {
    expect(isAllowedKey('arbitrary')).toBe(false);
    expect(isAllowedKey('disableReadyAudioExtra')).toBe(false);
  });
});
