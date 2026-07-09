import { useSyncExternalStore } from 'react';
import { subscribeTheme, getResolvedTheme } from '../theme/themeManager';
import type { ResolvedThemeBase } from '../theme/themes';

/** The currently rendered base theme; re-renders the component on change. */
export function useResolvedTheme(): ResolvedThemeBase {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme);
}
