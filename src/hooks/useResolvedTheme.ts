import { useSyncExternalStore } from 'react';
import { subscribeTheme, getResolvedTheme, getThemeEpoch } from '../theme/themeManager';
import type { ResolvedThemeBase } from '../theme/themes';

/** The currently rendered base theme; re-renders the component on change. */
export function useResolvedTheme(): ResolvedThemeBase {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme);
}

/**
 * Re-renders on every applied-theme change, including between two themes
 * with the same base, which useResolvedTheme cannot see. Use this in
 * components that read token values (readToken/getComputedStyle) at render
 * time.
 */
export function useThemeEpoch(): number {
  return useSyncExternalStore(subscribeTheme, getThemeEpoch);
}
