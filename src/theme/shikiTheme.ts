/**
 * Shiki syntax-highlighting theme for each resolved base: the one owner of
 * the mapping for all shiki consumers (diff panel, plan markdown).
 */

import { getResolvedTheme } from './themeManager';

export const SHIKI_THEMES = { dark: 'github-dark', light: 'github-light' } as const;

export function currentShikiTheme(): (typeof SHIKI_THEMES)[keyof typeof SHIKI_THEMES] {
  return SHIKI_THEMES[getResolvedTheme()];
}
