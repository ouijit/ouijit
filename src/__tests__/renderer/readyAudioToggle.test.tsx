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
  test('notifyReady plays the sound when enabled', () => {
    setReadyAudioDisabled(false);
    notifyReady('Project', 'Ready');
    expect(play).toHaveBeenCalledTimes(1);
  });

  test('notifyReady does not play the sound when disabled', () => {
    setReadyAudioDisabled(true);
    notifyReady('Project', 'Ready');
    expect(play).not.toHaveBeenCalled();
  });

  test('re-enabling resumes playback', () => {
    setReadyAudioDisabled(true);
    notifyReady('Project', 'Ready');
    setReadyAudioDisabled(false);
    notifyReady('Project', 'Ready');
    expect(play).toHaveBeenCalledTimes(1);
  });

  test('hydrateNotificationSettings disables playback when the stored value is "1"', async () => {
    vi.mocked(window.api.globalSettings.get).mockResolvedValueOnce('1');
    await hydrateNotificationSettings();
    notifyReady('Project', 'Ready');
    expect(play).not.toHaveBeenCalled();
  });
});
