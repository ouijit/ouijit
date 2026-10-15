import { describe, test, expect, vi } from 'vitest';
import { notarizeAllowingUnstapled, notarizeDMGs } from '../../forge.dmg';

const ciEnv = { APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I', HOME: '/home/runner' };

describe('notarizeDMGs', () => {
  test('notarizes each DMG in turn with the CI key, and nothing else', async () => {
    const order: string[] = [];
    const notarizeFn = vi.fn().mockImplementation(async ({ appPath }: { appPath: string }) => {
      order.push(`start:${appPath}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(`end:${appPath}`);
    });

    await notarizeDMGs(
      ['/out/a.dmg', '/out/zip/darwin/arm64/ouijit-darwin-arm64.zip', '/out/ouijit-1.0.deb', '/out/b.dmg'],
      {
        env: ciEnv,
        notarizeFn,
      },
    );

    expect(order).toEqual(['start:/out/a.dmg', 'end:/out/a.dmg', 'start:/out/b.dmg', 'end:/out/b.dmg']);
    expect(notarizeFn).toHaveBeenCalledWith({
      appPath: '/out/a.dmg',
      appleApiKey: '/home/runner/private_keys/AuthKey_K.p8',
      appleApiKeyId: 'K',
      appleApiIssuer: 'I',
    });
  });

  test('uses the keychain profile without CI credentials, and nothing under SKIP_NOTARIZE', async () => {
    const notarizeFn = vi.fn().mockResolvedValue(undefined);

    await notarizeDMGs(['/out/a.dmg'], { env: { HOME: '/Users/me' }, notarizeFn });
    expect(notarizeFn).toHaveBeenCalledWith({ appPath: '/out/a.dmg', keychainProfile: 'ouijit-notarize' });

    notarizeFn.mockClear();
    await notarizeDMGs(['/out/a.dmg'], { env: { ...ciEnv, SKIP_NOTARIZE: '1' }, notarizeFn });
    expect(notarizeFn).not.toHaveBeenCalled();
  });
});

describe('notarizeAllowingUnstapled', () => {
  test('carries on past a failed staple but not a failed notarization', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stapleFailure = new Error(
      'Failed to staple your application with code: 68\n\nThe staple and validate action failed! Error 68.',
    );

    await expect(
      notarizeAllowingUnstapled('/out/a.dmg', { env: ciEnv, notarizeFn: vi.fn().mockRejectedValue(stapleFailure) }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Notarized but not stapled: /out/a.dmg'));

    const rejected = new Error('Failed to notarize via notarytool\n\n{"status":"Invalid"}');
    await expect(
      notarizeAllowingUnstapled('/out/a.dmg', { env: ciEnv, notarizeFn: vi.fn().mockRejectedValue(rejected) }),
    ).rejects.toBe(rejected);

    warn.mockRestore();
  });
});
