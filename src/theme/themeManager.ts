/**
 * Renderer theme runtime.
 *
 * Applies the selected theme to <html> (a `data-theme` attribute picks the
 * built-in base from tokens.css; custom themes additionally set inline
 * `--token` overrides), follows the OS appearance in 'system' mode, and
 * notifies subscribers (xterm, shiki consumers) when the resolved theme
 * changes.
 *
 * Persistence: the source of truth is global settings (`ui:theme`,
 * `ui:customThemes`). A localStorage mirror lets the very first paint apply
 * the right theme synchronously, before the async settings round-trip. The
 * resolved background color is mirrored to `ui:themeBackground` so the main
 * process can paint new windows the right color before the renderer loads.
 */

import log from 'electron-log/renderer';
import {
  type ThemePreference,
  type ResolvedThemeBase,
  type CustomTheme,
  THEME_PREFERENCE_KEY,
  CUSTOM_THEMES_KEY,
  WINDOW_BACKGROUND_KEY,
  isThemePreference,
  isWindowBackgroundColor,
  parseCustomThemes,
  upsertCustomTheme,
  resolveThemeBase,
  selectedCustomTheme,
} from './themes';
import { withPresets, selectionOrphanedByDelete } from './presets';

const themeLog = log.scope('theme');

const LOCAL_CACHE_KEY = 'ouijit:theme-cache';

let preference: ThemePreference = 'system';
/** Hover-preview override; non-null renders this theme instead of `preference` without persisting. */
let previewPreference: ThemePreference | null = null;
let customThemes: CustomTheme[] = [];
/** Token names currently overridden inline by a custom theme. */
let appliedTokenNames: string[] = [];
/** Bumped on every applied-theme change; lets consumers cache token reads per applied theme. */
let themeEpoch = 0;
/** Last values written to the persistence mirrors, to skip redundant writes. */
let mirroredBackground: string | null = null;
let cachedThemeJson: string | null = null;
const subscribers = new Set<() => void>();

// customThemes is replaced (never mutated), so the merged list can be cached
// per array identity; getResolvedTheme() is a useSyncExternalStore snapshot
// called on every render of subscribed components.
let mergedThemesCache: { source: CustomTheme[]; merged: CustomTheme[] } | null = null;
function mergedThemes(): CustomTheme[] {
  if (mergedThemesCache?.source !== customThemes) {
    mergedThemesCache = { source: customThemes, merged: withPresets(customThemes) };
  }
  return mergedThemesCache.merged;
}

// Created lazily: this module is transitively imported by code that also runs
// in Node test environments where window doesn't exist.
let prefersDarkQueryCache: MediaQueryList | null = null;
function prefersDarkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  prefersDarkQueryCache ??= window.matchMedia('(prefers-color-scheme: dark)');
  return prefersDarkQueryCache;
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(): ResolvedThemeBase {
  return resolveThemeBase(previewPreference ?? preference, prefersDarkQuery()?.matches ?? true, mergedThemes());
}

/**
 * Identity of the currently applied theme. Unlike the resolved base, this
 * changes on every theme switch, including between two themes with the same
 * base, so consumers that read token values can use it as a cache key.
 */
export function getThemeEpoch(): number {
  return themeEpoch;
}

export function getCustomThemes(): CustomTheme[] {
  return customThemes;
}

export function subscribeTheme(callback: () => void): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/** Read a design token's current computed value, e.g. readToken('--color-accent'). */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyTheme(): void {
  const root = document.documentElement;
  const base = getResolvedTheme();

  if (base === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    root.removeAttribute('data-theme');
  }

  for (const name of appliedTokenNames) {
    root.style.removeProperty(name);
  }
  appliedTokenNames = [];

  const custom = selectedCustomTheme(previewPreference ?? preference, mergedThemes());
  if (custom) {
    for (const [name, value] of Object.entries(custom.tokens)) {
      root.style.setProperty(name, value);
      appliedTokenNames.push(name);
    }
  }

  themeEpoch++;
  for (const callback of subscribers) callback();

  // A hover preview must leave no trace — skip the persistence mirrors.
  if (previewPreference !== null) return;

  // Mirror the resolved window background for the main process. Only plain
  // hex values are useful there (BrowserWindow.setBackgroundColor).
  const background = readToken('--color-background');
  if (background !== mirroredBackground && isWindowBackgroundColor(background)) {
    mirroredBackground = background;
    void window.api.globalSettings.set(WINDOW_BACKGROUND_KEY, background);
  }

  const cacheJson = JSON.stringify({ preference, customThemes });
  if (cacheJson !== cachedThemeJson) {
    cachedThemeJson = cacheJson;
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, cacheJson);
    } catch {
      // localStorage is best-effort; the settings DB remains the source of truth.
    }
  }
}

/**
 * Apply the cached theme synchronously before first render so light-mode
 * users don't get a dark flash on every launch.
 */
export function initThemeSync(): void {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return;
    const cached: unknown = JSON.parse(raw);
    if (typeof cached !== 'object' || cached === null) return;
    const obj = cached as { preference?: unknown; customThemes?: unknown };
    if (typeof obj.preference === 'string' && isThemePreference(obj.preference)) {
      preference = obj.preference;
    }
    customThemes = parseCustomThemes(JSON.stringify(obj.customThemes ?? []));
    applyTheme();
  } catch {
    // Corrupt cache — stay on the default theme until initTheme() reconciles.
  }
}

/** Re-read the persisted theme from global settings into module state. Returns false when the read failed. */
async function loadPersistedTheme(): Promise<boolean> {
  try {
    const [storedPreference, storedCustomThemes] = await Promise.all([
      window.api.globalSettings.get(THEME_PREFERENCE_KEY),
      window.api.globalSettings.get(CUSTOM_THEMES_KEY),
    ]);
    customThemes = parseCustomThemes(storedCustomThemes);
    preference = storedPreference && isThemePreference(storedPreference) ? storedPreference : 'system';
    return true;
  } catch (error) {
    themeLog.error('failed to load theme settings', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Load the persisted theme from global settings and start following the OS. */
export async function initTheme(): Promise<void> {
  await loadPersistedTheme();

  prefersDarkQuery()?.addEventListener('change', () => {
    if (preference === 'system') applyTheme();
  });

  applyTheme();
}

/**
 * Re-read persisted theme settings and re-apply. Needed after a CLI theme
 * mutation: the main process writes the settings DB directly, leaving this
 * module's state stale.
 */
export async function reloadTheme(): Promise<void> {
  if (await loadPersistedTheme()) applyTheme();
}

/**
 * Temporarily render a theme without persisting anything (dropdown hover
 * preview). Pass null to restore the committed preference.
 */
export function previewTheme(pref: ThemePreference | null): void {
  if (previewPreference === pref) return;
  previewPreference = pref;
  applyTheme();
}

export async function setThemePreference(next: ThemePreference): Promise<void> {
  preference = next;
  previewPreference = null;
  applyTheme();
  await window.api.globalSettings.set(THEME_PREFERENCE_KEY, next);
  themeLog.info('theme preference changed', { preference: next });
}

/** Add or update a custom theme. Does not select it. */
export async function saveCustomTheme(theme: CustomTheme): Promise<void> {
  customThemes = upsertCustomTheme(customThemes, theme);
  await persistCustomThemes();
  applyTheme();
}

export async function deleteCustomTheme(id: string): Promise<void> {
  customThemes = customThemes.filter((t) => t.id !== id);
  if (selectionOrphanedByDelete(preference, id)) {
    await setThemePreference('system');
  }
  await persistCustomThemes();
  applyTheme();
}

async function persistCustomThemes(): Promise<void> {
  await window.api.globalSettings.set(CUSTOM_THEMES_KEY, JSON.stringify(customThemes));
}
