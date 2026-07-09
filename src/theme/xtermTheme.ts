/**
 * Builds the xterm.js theme object from the design tokens in
 * src/theme/tokens.css, so terminals re-skin with the rest of the app.
 * Call again after a theme change (see subscribeTheme) and assign the result
 * to `terminal.options.theme` — xterm repaints on theme assignment.
 */

import { readToken } from './themeManager';

export interface XtermThemeColors extends Record<string, string> {
  background: string;
  foreground: string;
}

export function buildXtermTheme(): XtermThemeColors {
  return {
    background: readToken('--color-terminal-bg'),
    foreground: readToken('--color-terminal-fg'),
    cursor: readToken('--color-terminal-fg'),
    cursorAccent: readToken('--color-terminal-bg'),
    selectionBackground: readToken('--terminal-selection'),
    scrollbarSliderBackground: readToken('--terminal-scrollbar'),
    scrollbarSliderHoverBackground: readToken('--terminal-scrollbar-hover'),
    scrollbarSliderActiveBackground: readToken('--terminal-scrollbar-active'),
    black: readToken('--color-ansi-black'),
    red: readToken('--color-ansi-red'),
    green: readToken('--color-ansi-green'),
    yellow: readToken('--color-ansi-yellow'),
    blue: readToken('--color-ansi-blue'),
    magenta: readToken('--color-ansi-magenta'),
    cyan: readToken('--color-ansi-cyan'),
    white: readToken('--color-ansi-white'),
    brightBlack: readToken('--color-ansi-bright-black'),
    brightRed: readToken('--color-ansi-bright-red'),
    brightGreen: readToken('--color-ansi-bright-green'),
    brightYellow: readToken('--color-ansi-bright-yellow'),
    brightBlue: readToken('--color-ansi-bright-blue'),
    brightMagenta: readToken('--color-ansi-bright-magenta'),
    brightCyan: readToken('--color-ansi-bright-cyan'),
    brightWhite: readToken('--color-ansi-bright-white'),
  };
}
