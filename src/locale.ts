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
  available: readonly string[],
): string | undefined {
  if (env.LC_ALL || env.LC_CTYPE || env.LANG) return undefined;
  const utf8 = available.map((name) => name.trim()).filter((name) => /\.utf-?8$/i.test(name));
  const language = localeName(preferred);
  return (
    (language && utf8.find((name) => name.startsWith(`${language}.`))) ||
    utf8.find((name) => name.startsWith('en_US.')) ||
    utf8.find((name) => name.startsWith('C.')) ||
    utf8[0]
  );
}

/** A BCP 47 tag can carry a script subtag `locale -a` never names: `zh-Hans-CN` is `zh_CN`. */
function localeName(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  const parts = tag.split('-');
  return parts.length > 1 ? `${parts[0]}_${parts[parts.length - 1]}` : parts[0];
}
