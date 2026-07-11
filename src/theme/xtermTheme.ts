/**
 * Builds the xterm.js theme object from the design tokens in
 * src/theme/tokens.css, so terminals re-skin with the rest of the app.
 * Call again after a theme change (see subscribeTheme) and assign the result
 * to `terminal.options.theme` — xterm repaints on theme assignment.
 *
 * The built object is cached per applied theme (see getThemeEpoch).
 */

import { getThemeEpoch } from './themeManager';

export interface XtermThemeColors extends Record<string, string> {
  background: string;
  foreground: string;
}

let cache: { epoch: number; theme: XtermThemeColors } | null = null;

export function buildXtermTheme(): XtermThemeColors {
  const epoch = getThemeEpoch();
  if (cache?.epoch === epoch) return cache.theme;

  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => style.getPropertyValue(name).trim();

  const theme: XtermThemeColors = {
    background: token('--color-terminal-bg'),
    foreground: token('--color-terminal-fg'),
    cursor: token('--color-terminal-fg'),
    cursorAccent: token('--color-terminal-bg'),
    selectionBackground: token('--terminal-selection'),
    scrollbarSliderBackground: token('--terminal-scrollbar'),
    scrollbarSliderHoverBackground: token('--terminal-scrollbar-hover'),
    scrollbarSliderActiveBackground: token('--terminal-scrollbar-active'),
    black: token('--color-ansi-black'),
    red: token('--color-ansi-red'),
    green: token('--color-ansi-green'),
    yellow: token('--color-ansi-yellow'),
    blue: token('--color-ansi-blue'),
    magenta: token('--color-ansi-magenta'),
    cyan: token('--color-ansi-cyan'),
    white: token('--color-ansi-white'),
    brightBlack: token('--color-ansi-bright-black'),
    brightRed: token('--color-ansi-bright-red'),
    brightGreen: token('--color-ansi-bright-green'),
    brightYellow: token('--color-ansi-bright-yellow'),
    brightBlue: token('--color-ansi-bright-blue'),
    brightMagenta: token('--color-ansi-bright-magenta'),
    brightCyan: token('--color-ansi-bright-cyan'),
    brightWhite: token('--color-ansi-bright-white'),
  };
  cache = { epoch, theme };
  return theme;
}
