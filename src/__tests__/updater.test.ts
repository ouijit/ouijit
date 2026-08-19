import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForLinuxUpdate, initUpdater, cleanupUpdater, _resetForTesting } from '../updater';
import { semverGt } from '../utils/semver';

// Mock electron modules
const mockGetVersion = vi.fn(() => '1.0.0');
const mockFetch = vi.fn();
const mockTypedPush = vi.fn();
const mockCheckForUpdates = vi.fn();
const mockQuitAndInstall = vi.fn();
const mockShowMessageBox = vi.fn(() => Promise.resolve({ response: 1 }));
const updaterHandlers = new Map<string, (...args: unknown[]) => void>();
let isPackaged = false;

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test',
    getName: () => 'ouijit',
    get isPackaged() {
      return isPackaged;
    },
    getVersion: () => mockGetVersion(),
  },
  autoUpdater: {
    setFeedURL: vi.fn(),
    on: (event: string, handler: (...args: unknown[]) => void) => updaterHandlers.set(event, handler),
    checkForUpdates: () => mockCheckForUpdates(),
    quitAndInstall: () => mockQuitAndInstall(),
  },
  dialog: {
    showMessageBox: () => mockShowMessageBox(),
  },
  net: {
    fetch: (...args: unknown[]) => mockFetch(...args),
  },
  BrowserWindow: vi.fn(),
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
    isPackaged = false;
    delete process.env.OUIJIT_DISABLE_UPDATES;
  });

  it('returns early when OUIJIT_DISABLE_UPDATES=1', async () => {
    process.env.OUIJIT_DISABLE_UPDATES = '1';
    await initUpdater(mockWindow);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns early in dev mode (not packaged)', async () => {
    await initUpdater(mockWindow);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('macOS update checks', () => {
  const stageUpdate = (releaseName?: string) =>
    updaterHandlers.get('update-downloaded')?.(undefined, undefined, releaseName);

  const hourPasses = async () => {
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  };

  const latestRelease = (tag: string) => ({
    ok: true,
    json: () => Promise.resolve({ tag_name: tag, html_url: 'https://example.com' }),
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    updaterHandlers.clear();
    _resetForTesting();
    vi.useFakeTimers();
    delete process.env.OUIJIT_DISABLE_UPDATES;
    isPackaged = true;
    mockGetVersion.mockReturnValue('1.0.0');
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    await initUpdater(mockWindow);
    mockCheckForUpdates.mockClear();
  });

  afterEach(() => {
    cleanupUpdater();
    vi.useRealTimers();
    isPackaged = false;
  });

  it('keeps checking hourly while nothing is staged', async () => {
    await hourPasses();
    await hourPasses();

    expect(mockCheckForUpdates).toHaveBeenCalledTimes(2);
  });

  it('stops checking once an update is staged', async () => {
    mockFetch.mockResolvedValue(latestRelease('v1.1.0'));
    stageUpdate('v1.1.0');

    await hourPasses();
    await hourPasses();

    expect(mockCheckForUpdates).not.toHaveBeenCalled();
    expect(mockShowMessageBox).toHaveBeenCalledTimes(1);
  });

  it('checks again when a release newer than the staged one ships', async () => {
    stageUpdate('v1.1.0');
    mockFetch.mockResolvedValue(latestRelease('v1.2.0'));

    await hourPasses();

    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it('stays put when the staged version cannot be read from the feed', async () => {
    mockFetch.mockResolvedValue(latestRelease('v9.9.9'));
    stageUpdate(undefined);

    await hourPasses();

    expect(mockCheckForUpdates).not.toHaveBeenCalled();
  });

  it('stays put when the release lookup fails', async () => {
    stageUpdate('v1.1.0');
    mockFetch.mockRejectedValue(new Error('network failure'));

    await hourPasses();

    expect(mockCheckForUpdates).not.toHaveBeenCalled();
  });

  it('installs the staged update when the user picks Restart', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 });

    stageUpdate('v1.1.0');
    await vi.waitFor(() => expect(mockQuitAndInstall).toHaveBeenCalled());
  });
});
