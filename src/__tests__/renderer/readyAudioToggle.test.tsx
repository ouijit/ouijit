import { describe, test, expect, beforeEach, vi } from 'vitest';
import { notifyReady, setReadyAudioDisabled, hydrateNotificationSettings } from '../../utils/notifications';

// Shared play spy. notifyReady caches its Audio element on first use, so every
// `new Audio()` returns an object backed by this same spy — that way the cache
// can't smuggle a stale reference past mockClear() between tests.
const play = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  play.mockClear();
  vi.stubGlobal(
    'Audio',
    class {
      currentTime = 0;
      play = play;
    },
  );
  // Keep notifyReady on the audio-only path: focused window short-circuits the
  // OS-notification branch before it touches the (unstubbed) Notification API.
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  setReadyAudioDisabled(false);
});

describe('ready-audio toggle', () => {
  // Both directions of the `if (!readyAudioDisabled)` gate in notifyReady.
  test('notifyReady plays the sound when enabled, stays silent when disabled', () => {
    setReadyAudioDisabled(false);
    notifyReady('Project', 'Ready');
    expect(play).toHaveBeenCalledTimes(1);

    play.mockClear();
    setReadyAudioDisabled(true);
    notifyReady('Project', 'Ready');
    expect(play).not.toHaveBeenCalled();
  });

  test('hydrateNotificationSettings applies the persisted "1" before the first notifyReady', async () => {
    vi.mocked(window.api.globalSettings.get).mockResolvedValueOnce('1');
    await hydrateNotificationSettings();
    notifyReady('Project', 'Ready');
    expect(play).not.toHaveBeenCalled();
  });
});
