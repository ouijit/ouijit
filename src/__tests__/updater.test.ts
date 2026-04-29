import { describe, it, expect, vi, beforeEach } from 'vitest';
import { semverGt, checkForLinuxUpdate, initUpdater, _resetForTesting } from '../updater';

// Mock electron modules
const mockGetVersion = vi.fn(() => '1.0.0');
const mockFetch = vi.fn();
const mockTypedPush = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test',
    get isPackaged() {
      return false;
    },
    getVersion: () => mockGetVersion(),
  },
  net: {
    fetch: (...args: unknown[]) => mockFetch(...args),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('update-electron-app', () => ({
  updateElectronApp: vi.fn(),
  UpdateSourceType: { ElectronPublicUpdateService: 0 },
}));

vi.mock('../ipc/helpers', () => ({
  typedPush: (...args: unknown[]) => mockTypedPush(...args),
}));

const mockWindow = { isDestroyed: () => false } as any;

describe('semverGt', () => {
  it('returns true when a > b (patch)', () => {
    expect(semverGt('1.0.1', '1.0.0')).toBe(true);
  });

  it('returns true when a > b (minor)', () => {
    expect(semverGt('1.1.0', '1.0.9')).toBe(true);
  });

  it('returns true when a > b (major)', () => {
    expect(semverGt('2.0.0', '1.9.9')).toBe(true);
  });

  it('returns false when equal', () => {
    expect(semverGt('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when a < b', () => {
    expect(semverGt('1.0.0', '1.0.1')).toBe(false);
  });

  it('handles double-digit segments correctly', () => {
    expect(semverGt('1.0.10', '1.0.9')).toBe(true);
    expect(semverGt('1.0.2', '1.0.10')).toBe(false);
  });
});

describe('checkForLinuxUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockGetVersion.mockReturnValue('1.0.0');
  });

  it('pushes update-available when newer version exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tag_name: 'v1.1.0', html_url: 'https://github.com/ouijit/ouijit/releases/v1.1.0' }),
    });

    await checkForLinuxUpdate(mockWindow);

    expect(mockTypedPush).toHaveBeenCalledWith(mockWindow, 'update-available', {
      version: '1.1.0',
      url: 'https://github.com/ouijit/ouijit/releases/v1.1.0',
    });
  });

  it('strips v prefix from tag_name', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tag_name: 'v2.0.0', html_url: 'https://example.com' }),
    });

    await checkForLinuxUpdate(mockWindow);

    expect(mockTypedPush).toHaveBeenCalledWith(mockWindow, 'update-available', {
      version: '2.0.0',
      url: 'https://example.com',
    });
  });

  it('does not push when current version matches latest', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tag_name: 'v1.0.0', html_url: 'https://example.com' }),
    });

    await checkForLinuxUpdate(mockWindow);

    expect(mockTypedPush).not.toHaveBeenCalled();
  });

  it('does not push when current version is newer', async () => {
    mockGetVersion.mockReturnValue('2.0.0');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tag_name: 'v1.0.0', html_url: 'https://example.com' }),
    });

    await checkForLinuxUpdate(mockWindow);

    expect(mockTypedPush).not.toHaveBeenCalled();
  });

  it('suppresses duplicate notifications for same version', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tag_name: 'v1.1.0', html_url: 'https://example.com' }),
    });

    await checkForLinuxUpdate(mockWindow);
    await checkForLinuxUpdate(mockWindow);

    expect(mockTypedPush).toHaveBeenCalledTimes(1);
  });

  it('handles non-ok response without throwing', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    await checkForLinuxUpdate(mockWindow);

    expect(mockTypedPush).not.toHaveBeenCalled();
  });

  it('handles network errors without throwing', async () => {
    mockFetch.mockRejectedValue(new Error('network failure'));

    await checkForLinuxUpdate(mockWindow);

    expect(mockTypedPush).not.toHaveBeenCalled();
  });
});

describe('initUpdater opt-out gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    delete process.env.OUIJIT_DISABLE_UPDATES;
  });

  it('returns early when OUIJIT_DISABLE_UPDATES=1', async () => {
    process.env.OUIJIT_DISABLE_UPDATES = '1';
    await initUpdater(mockWindow);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns early in dev mode (not packaged)', async () => {
    // app.isPackaged is hard-coded to false in the mock above
    await initUpdater(mockWindow);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
