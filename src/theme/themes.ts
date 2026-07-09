/**
 * Theme model — pure types and helpers, no DOM or Electron dependencies.
 *
 * The app ships two built-in themes, dark (the default) and light, defined
 * entirely in src/theme/tokens.css. A custom theme layers token overrides on
 * top of one of those bases; it can override any token defined in tokens.css
 * (colors, shadows, ANSI palette, …).
 */

/** Built-in selection values plus `custom:<id>` for user themes. */
export type ThemePreference = 'system' | 'dark' | 'light' | `custom:${string}`;

export type ResolvedThemeBase = 'dark' | 'light';

export interface CustomTheme {
  id: string;
  name: string;
  /** Which built-in theme supplies the tokens this theme doesn't override. */
  base: ResolvedThemeBase;
  /** CSS custom property overrides, e.g. { '--color-accent': '#ff2d55' }. */
  tokens: Record<string, string>;
}

const TOKEN_NAME_RE = /^--[a-z0-9-]+$/;
/** Reject values that could escape a CSS declaration. */
const TOKEN_VALUE_RE = /^[^;{}<>]+$/;

export function isThemePreference(value: string): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'light' || value.startsWith('custom:');
}

/** Validate an untrusted parsed JSON value into a CustomTheme, or null. */
export function parseCustomTheme(value: unknown): CustomTheme | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.length === 0 || obj.id.length > 64) return null;
  if (typeof obj.name !== 'string' || obj.name.length === 0 || obj.name.length > 64) return null;
  if (obj.base !== 'dark' && obj.base !== 'light') return null;
  if (typeof obj.tokens !== 'object' || obj.tokens === null) return null;
  const tokens: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj.tokens as Record<string, unknown>)) {
    if (typeof val !== 'string') return null;
    if (!TOKEN_NAME_RE.test(key) || !TOKEN_VALUE_RE.test(val)) return null;
    tokens[key] = val;
  }
  return { id: obj.id, name: obj.name, base: obj.base, tokens };
}

/** Parse the persisted `ui:customThemes` JSON, dropping invalid entries. */
export function parseCustomThemes(json: string | undefined): CustomTheme[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseCustomTheme).filter((t): t is CustomTheme => t !== null);
  } catch {
    return [];
  }
}

/**
 * Resolve a preference to the base theme the DOM should render.
 * Unknown custom ids fall back to system resolution.
 */
export function resolveThemeBase(
  preference: ThemePreference,
  systemPrefersDark: boolean,
  customThemes: CustomTheme[],
): ResolvedThemeBase {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  if (preference.startsWith('custom:')) {
    const custom = customThemes.find((t) => `custom:${t.id}` === preference);
    if (custom) return custom.base;
  }
  return systemPrefersDark ? 'dark' : 'light';
}

/** The custom theme selected by a preference, if any. */
export function selectedCustomTheme(preference: ThemePreference, customThemes: CustomTheme[]): CustomTheme | null {
  if (!preference.startsWith('custom:')) return null;
  return customThemes.find((t) => `custom:${t.id}` === preference) ?? null;
}
