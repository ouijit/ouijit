import { describe, test, expect } from 'vitest';

import { pickLocale } from '../locale';

const MACOS = ['C', 'POSIX', 'en_US.UTF-8', 'en_GB.UTF-8', 'nb_NO.UTF-8', 'ja_JP.eucJP'];
const LINUX = ['C', 'C.utf8', 'en_US.utf8', 'nb_NO.utf8'];

describe('pickLocale', () => {
  test('prefers the system language, in the spelling the system uses', () => {
    expect(pickLocale({}, 'nb-NO', MACOS)).toBe('nb_NO.UTF-8');
    expect(pickLocale({}, 'nb-NO', LINUX)).toBe('nb_NO.utf8');
    expect(pickLocale({}, 'zh-Hans-CN', ['zh_CN.UTF-8', ...MACOS])).toBe('zh_CN.UTF-8');
  });

  test('fills in the region for a language the system names without one', () => {
    expect(pickLocale({}, 'nb', MACOS)).toBe('nb_NO.UTF-8');
    expect(pickLocale({}, 'en', MACOS)).toBe('en_US.UTF-8');
    expect(pickLocale({}, 'fr', ['fr_BE.UTF-8', 'fr_FR.UTF-8', ...MACOS])).toBe('fr_FR.UTF-8');
    expect(pickLocale({}, 'zh', ['zh_TW.UTF-8', 'zh_CN.UTF-8', ...MACOS])).toBe('zh_CN.UTF-8');
  });

  test('settles for another region of the same language', () => {
    expect(pickLocale({}, 'fr-FR', ['fr_BE.UTF-8', ...MACOS])).toBe('fr_BE.UTF-8');
    expect(pickLocale({}, 'fr', ['fr_BE.UTF-8', ...MACOS])).toBe('fr_BE.UTF-8');
  });

  test('falls back to en_US when the system language has no UTF-8 locale', () => {
    expect(pickLocale({}, 'ja-JP', MACOS)).toBe('en_US.UTF-8');
    expect(pickLocale({}, undefined, MACOS)).toBe('en_US.UTF-8');
  });

  test('takes any UTF-8 locale over none', () => {
    expect(pickLocale({}, 'de-DE', ['C', 'nb_NO.UTF-8'])).toBe('nb_NO.UTF-8');
    expect(pickLocale({}, 'de-DE', ['nb_NO.utf8', 'C.utf8'])).toBe('C.utf8');
    expect(pickLocale({}, 'de-DE', ['C', 'POSIX', 'ja_JP.eucJP'])).toBeUndefined();
  });

  test.each(['LANG', 'LC_ALL', 'LC_CTYPE'])('leaves an environment that already sets %s alone', (key) => {
    expect(pickLocale({ [key]: 'C' }, 'en-US', MACOS)).toBeUndefined();
  });
});
