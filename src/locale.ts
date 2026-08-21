import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

/**
 * LANG is the emulator's to declare, alongside TERM: xterm.js decodes UTF-8 and
 * nothing else. A Finder launch supplies none, and under C every byte above
 * 0x7f is unprintable — less renders box drawing as `<E2><94><82>`.
 */
export async function terminalLocale(base: NodeJS.ProcessEnv): Promise<Record<string, string>> {
  const preferred = app.isReady() ? app.getLocale() : undefined;
  const locale = pickLocale(base, preferred, await availableLocales());
  return locale ? { LANG: locale } : {};
}

let available: Promise<string[]> | null = null;

async function availableLocales(): Promise<string[]> {
  const locales = await (available ??= readLocales());
  // An empty list means `locale -a` failed; keeping it would leave every
  // terminal for the rest of the session without LANG.
  if (locales.length === 0) available = null;
  return locales;
}

async function readLocales(): Promise<string[]> {
  if (process.platform === 'win32') return [];
  try {
    const { stdout } = await execFileAsync('locale', ['-a'], { encoding: 'utf8', timeout: 5000 });
    return stdout.split('\n');
  } catch {
    return [];
  }
}

/**
 * Only names `locale -a` reports: an absent one falls back to C silently, and
 * the spelling is platform-specific — `en_US.UTF-8` on macOS, `en_US.utf8` on
 * Linux. `C.*` outranks the last resort because macOS lists locales unsorted,
 * so utf8[0] is an arbitrary language.
 */
export function pickLocale(
  env: NodeJS.ProcessEnv,
  preferred: string | undefined,
  installed: readonly string[],
): string | undefined {
  if (env.LC_ALL || env.LC_CTYPE || env.LANG) return undefined;
  const utf8 = installed.map((name) => name.trim()).filter((name) => /\.utf-?8$/i.test(name));
  const name = localeName(preferred);
  const language = name?.split('_')[0];
  return (
    (name && utf8.find((locale) => locale.startsWith(`${name}.`))) ||
    (language && utf8.find((locale) => locale.startsWith(`${language}_`))) ||
    utf8.find((locale) => locale.startsWith('en_US.')) ||
    utf8.find((locale) => locale.startsWith('C.')) ||
    utf8[0]
  );
}

/**
 * `locale -a` names a region and no script; a BCP 47 tag from `app.getLocale()`
 * can do the opposite — `zh-Hans-CN` and `nb` are `zh_CN` and `nb_NO`. Widening
 * the tag first fills in the region CLDR considers likely for the language.
 */
function localeName(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  try {
    const { language, region } = new Intl.Locale(tag).maximize();
    return region ? `${language}_${region}` : language;
  } catch {
    return tag.split('-')[0];
  }
}
