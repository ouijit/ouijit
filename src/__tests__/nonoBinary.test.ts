import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { getNonoPath, getVendoredNonoPath, checkPlatformSupport } from '../sandbox/nono/binary';

// The bundled-binary resolution logic is shared in paths.ts (exercised by its
// own coverage); here we mock it to verify getNonoPath delegates with the right
// binary name rather than re-testing the resolver's fs probing.
const resolveBundledBinaryMock = vi.fn<(name: string) => string>();
vi.mock('../paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../paths')>();
  return { ...actual, resolveBundledBinary: (name: string) => resolveBundledBinaryMock(name) };
});

const osReleaseMock = vi.fn(() => '23.0.0');
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, release: () => osReleaseMock() };
});

const realPlatform = process.platform;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  resolveBundledBinaryMock.mockReset();
  osReleaseMock.mockReturnValue('23.0.0');
});

afterEach(() => {
  setPlatform(realPlatform);
});

describe('getNonoPath', () => {
  test('resolves the nono binary via the shared bundled-binary resolver', () => {
    resolveBundledBinaryMock.mockReturnValue('/app/resources/bin/nono');
    expect(getNonoPath()).toBe('/app/resources/bin/nono');
    expect(resolveBundledBinaryMock).toHaveBeenCalledWith('nono');
  });

  test('falls back to `nono` on PATH when the bundled binary is absent', () => {
    resolveBundledBinaryMock.mockReturnValue('nono');
    expect(getNonoPath()).toBe('nono');
  });
});

describe('getVendoredNonoPath', () => {
  test('returns the bundled path when vendored, null when nono resolves to PATH', () => {
    resolveBundledBinaryMock.mockReturnValue('/app/resources/bin/nono');
    expect(getVendoredNonoPath()).toBe('/app/resources/bin/nono');
    resolveBundledBinaryMock.mockReturnValue('nono');
    expect(getVendoredNonoPath()).toBeNull();
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
