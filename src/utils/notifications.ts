/**
 * OS notification utilities with custom sound support.
 */

import transitionUpUrl from '../assets/sounds/transition_up.wav?url';
import transitionDownUrl from '../assets/sounds/transition_down.wav?url';

// Cached Audio elements (created lazily)
let transitionUpAudio: HTMLAudioElement | null = null;
let transitionDownAudio: HTMLAudioElement | null = null;

/** Build notification body from terminal label and OSC title. */
export function readyBody(label: string, oscTitle: string): string {
  if (label !== 'Shell') return `${label} is ready`;
  if (oscTitle) return `Ready — ${oscTitle}`;
  return 'Ready';
}

/** Play the transition-up sound and show an OS notification when unfocused. */
export function notifyReady(title: string, body: string): void {
  if (!transitionUpAudio) {
    transitionUpAudio = new Audio(transitionUpUrl);
  }
  transitionUpAudio.currentTime = 0;
  transitionUpAudio.play().catch(() => {});

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
