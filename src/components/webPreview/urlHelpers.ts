/**
 * URL utilities for the web preview panel.
 *
 * Kept separate so they can be unit-tested without pulling in React or
 * the Electron <webview> element.
 */

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Bare host:port or host — assume http for dev servers.
  return `http://${trimmed}`;
}
