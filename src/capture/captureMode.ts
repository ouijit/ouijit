/**
 * Capture mode: headless-ish screenshot flow driven by scripts/capture.
 *
 * When `OUIJIT_CAPTURE_MODE=1`, the app boots against a pre-seeded SQLite DB
 * (via OUIJIT_TEST_USER_DATA), pins the window to fixed dimensions, skips
 * updater polling, and exposes a few HTTP routes that let an external driver
 * navigate scenes + synthesize renderer state ahead of `screencapture`.
 *
 * Every capture-mode branch early-exits in production — the static token is
 * only registered when both env vars are present, and routes 404 otherwise.
 */

export const CAPTURE_WINDOW_WIDTH = 1280;
export const CAPTURE_WINDOW_HEIGHT = 800;
export const CAPTURE_READY_SENTINEL = '__OUIJIT_READY__';

export function isCaptureMode(): boolean {
  return process.env.OUIJIT_CAPTURE_MODE === '1';
}

export function getCaptureToken(): string | null {
  return process.env.OUIJIT_CAPTURE_TOKEN ?? null;
}
