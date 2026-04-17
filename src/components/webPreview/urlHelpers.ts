/**
 * URL utilities for the web preview panel.
 *
 * Kept separate so they can be unit-tested without pulling in React or
 * the Electron <webview> element.
 */

/** Normalize user-entered URL input: add http:// when a scheme is missing. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Bare host:port or host — assume http for dev servers.
  return `http://${trimmed}`;
}

// Strip ANSI CSI and OSC sequences so URLs split by color codes still match.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

// Match http[s]://localhost or loopback IP with required port. Requiring a
// port avoids false positives on documentation URLs that mention "localhost".
const DEV_SERVER_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+(?:\/[^\s]*)?/;

/**
 * Scan a runner-terminal output chunk for a dev server URL. Returns the first
 * match, stripped of ANSI escapes and trailing punctuation.
 */
export function detectDevServerUrl(chunk: string): string | null {
  const stripped = chunk.replace(ANSI_RE, '');
  const match = DEV_SERVER_URL_RE.exec(stripped);
  if (!match) return null;
  // Trim trailing punctuation commonly printed by loggers (e.g. ".", ")").
  return match[0].replace(/[.,;:!?)\]]+$/, '');
}
