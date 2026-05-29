/**
 * OS notification utilities with custom sound support.
 */

import transitionUpUrl from '../assets/sounds/transition_up.wav?url';
import transitionDownUrl from '../assets/sounds/transition_down.wav?url';

// Cached Audio elements (created lazily)
let transitionUpAudio: HTMLAudioElement | null = null;
let transitionDownAudio: HTMLAudioElement | null = null;

// Cached toggle for the task-ready sound. notifyReady runs often, so we read
// this cache rather than awaiting globalSettings.get on every call. The cache
// is hydrated once at boot and updated live when the setting changes.
let readyAudioDisabled = false;
let readyAudioHydrationStarted = false;

/**
 * Hydrate the ready-audio toggle from global settings. Idempotent — call once
 * at app boot. Until it resolves the sound plays (the default).
 */
export async function hydrateNotificationSettings(): Promise<void> {
  if (readyAudioHydrationStarted) return;
  readyAudioHydrationStarted = true;
  const value = await window.api.globalSettings.get('disableReadyAudio');
  readyAudioDisabled = value === '1';
}

/** Update the cached ready-audio toggle (called when the setting changes). */
export function setReadyAudioDisabled(disabled: boolean): void {
  readyAudioDisabled = disabled;
}

/** Build notification body from terminal label and OSC title. */
export function readyBody(label: string, oscTitle: string): string {
  if (label !== 'Shell') return `${label} is ready`;
  if (oscTitle) return `Ready — ${oscTitle}`;
  return 'Ready';
}

/** Play the transition-up sound and show an OS notification when unfocused. */
export function notifyReady(title: string, body: string): void {
  if (!readyAudioDisabled) {
    if (!transitionUpAudio) {
      transitionUpAudio = new Audio(transitionUpUrl);
    }
    transitionUpAudio.currentTime = 0;
    transitionUpAudio.play().catch(() => {});
  }

  if (!document.hasFocus() && Notification.permission === 'granted') {
    new Notification(title, { body, silent: true });
  }
}

/** Play the transition-down sound when entering thinking state. */
export function notifyThinking(): void {
  if (!transitionDownAudio) {
    transitionDownAudio = new Audio(transitionDownUrl);
  }
  transitionDownAudio.currentTime = 0;
  transitionDownAudio.play().catch(() => {});
}
