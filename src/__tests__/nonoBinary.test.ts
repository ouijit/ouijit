import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const accessSyncMock = vi.fn();
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, accessSync: (...a: unknown[]) => accessSyncMock(...(a as [])) };
});

const osReleaseMock = vi.fn(() => '23.0.0');
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, release: () => osReleaseMock() };
});

import { getNonoPath, checkPlatformSupport } from '../sandbox/nono/binary';

const realResourcesPath = process.resourcesPath;
const realPlatform = process.platform;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  accessSyncMock.mockReset();
  osReleaseMock.mockReturnValue('23.0.0');
});

afterEach(() => {
  Object.defineProperty(process, 'resourcesPath', { value: realResourcesPath, configurable: true });
  setPlatform(realPlatform);
});

describe('getNonoPath', () => {
  test('returns the bundled binary when it exists and is executable', () => {
    Object.defineProperty(process, 'resourcesPath', { value: '/app/resources', configurable: true });
    accessSyncMock.mockImplementation(() => undefined); // access OK
    expect(getNonoPath()).toBe('/app/resources/bin/nono');
  });

  test('falls back to `nono` on PATH when the bundled binary is absent', () => {
    Object.defineProperty(process, 'resourcesPath', { value: '/app/resources', configurable: true });
    accessSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getNonoPath()).toBe('nono');
  });
});

describe('checkPlatformSupport', () => {
  test('macOS (Seatbelt) is always supported', () => {
    setPlatform('darwin');
    expect(checkPlatformSupport()).toEqual({ supported: true });
  });

  test('Linux with kernel >= 5.13 is supported', () => {
    setPlatform('linux');
    osReleaseMock.mockReturnValue('6.5.0-generic');
    expect(checkPlatformSupport().supported).toBe(true);
  });

  test('Linux with kernel < 5.13 is unsupported with a reason', () => {
    setPlatform('linux');
    osReleaseMock.mockReturnValue('5.10.0-generic');
    const result = checkPlatformSupport();
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/5\.13/);
  });

  test('Linux at exactly 5.13 is supported', () => {
    setPlatform('linux');
    osReleaseMock.mockReturnValue('5.13.0');
    expect(checkPlatformSupport().supported).toBe(true);
  });

  test('non-macOS / non-Linux is unsupported', () => {
    setPlatform('win32');
    expect(checkPlatformSupport().supported).toBe(false);
  });
});
