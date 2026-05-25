import { describe, test, expect, vi } from 'vitest';
import { resolveSigningIdentity, notarizeAndStapleArtifact, notarizeAndStapleDMGs } from '../../forge.dmg';

describe('resolveSigningIdentity', () => {
  test('returns undefined when SKIP_SIGN is set', () => {
    const runSecurity = vi.fn();
    const id = resolveSigningIdentity({ SKIP_SIGN: '1' }, runSecurity);
    expect(id).toBeUndefined();
    expect(runSecurity).not.toHaveBeenCalled();
  });

  test('returns APPLE_SIGNING_IDENTITY when explicitly set', () => {
    const runSecurity = vi.fn();
    const id = resolveSigningIdentity(
      { APPLE_SIGNING_IDENTITY: 'Developer ID Application: Pinned (TEAM1)' },
      runSecurity,
    );
    expect(id).toBe('Developer ID Application: Pinned (TEAM1)');
    expect(runSecurity).not.toHaveBeenCalled();
  });

  test('autodiscovers the first Developer ID Application identity from the keychain', () => {
    const runSecurity = vi
      .fn()
      .mockReturnValue(
        [
          '  1) ABCDEF "Developer ID Application: First Cert (TEAM1)"',
          '  2) GHIJKL "Developer ID Application: Second Cert (TEAM2)"',
        ].join('\n'),
      );
    const id = resolveSigningIdentity({}, runSecurity);
    expect(id).toBe('Developer ID Application: First Cert (TEAM1)');
    expect(runSecurity).toHaveBeenCalledWith(['find-identity', '-v', '-p', 'codesigning']);
  });

  test('returns undefined when keychain has no Developer ID Application identity', () => {
    const runSecurity = vi.fn().mockReturnValue('  1) ABCDEF "Mac Developer: Someone (TEAM1)"\n');
    expect(resolveSigningIdentity({}, runSecurity)).toBeUndefined();
  });

  test('returns undefined when security command fails', () => {
    const runSecurity = vi.fn().mockImplementation(() => {
      throw new Error('security not found');
    });
    expect(resolveSigningIdentity({}, runSecurity)).toBeUndefined();
  });
});

describe('notarizeAndStapleArtifact', () => {
  test('notarizes using App Store Connect API credentials when provided', async () => {
    const notarizeFn = vi.fn().mockResolvedValue(undefined);
    const stapleFn = vi.fn();

    await notarizeAndStapleArtifact('/tmp/Install Ouijit.dmg', {
      creds: { appleApiKeyId: 'KEYID', appleApiIssuer: 'ISSUER', homeDir: '/home/runner' },
      notarizeFn,
      stapleFn,
    });

    expect(notarizeFn).toHaveBeenCalledWith({
      appPath: '/tmp/Install Ouijit.dmg',
      appleApiKey: '/home/runner/private_keys/AuthKey_KEYID.p8',
      appleApiKeyId: 'KEYID',
      appleApiIssuer: 'ISSUER',
    });
    expect(stapleFn).toHaveBeenCalledWith('/tmp/Install Ouijit.dmg');
  });

  test('notarizes using a keychain profile when no API credentials are provided', async () => {
    const notarizeFn = vi.fn().mockResolvedValue(undefined);
    const stapleFn = vi.fn();

    await notarizeAndStapleArtifact('/tmp/Install Ouijit.dmg', {
      keychainProfile: 'ouijit-notarize',
      notarizeFn,
      stapleFn,
    });

    expect(notarizeFn).toHaveBeenCalledWith({
      appPath: '/tmp/Install Ouijit.dmg',
      keychainProfile: 'ouijit-notarize',
    });
    expect(stapleFn).toHaveBeenCalledWith('/tmp/Install Ouijit.dmg');
  });

  test('throws when neither credentials nor keychain profile are supplied', async () => {
    const notarizeFn = vi.fn();
    const stapleFn = vi.fn();
    await expect(notarizeAndStapleArtifact('/tmp/Install Ouijit.dmg', { notarizeFn, stapleFn })).rejects.toThrow(
      /creds or keychainProfile/,
    );
    expect(notarizeFn).not.toHaveBeenCalled();
    expect(stapleFn).not.toHaveBeenCalled();
  });

  test('skips stapling when notarize rejects', async () => {
    const notarizeFn = vi.fn().mockRejectedValue(new Error('notarize failed'));
    const stapleFn = vi.fn();
    await expect(
      notarizeAndStapleArtifact('/tmp/Install Ouijit.dmg', {
        keychainProfile: 'ouijit-notarize',
        notarizeFn,
        stapleFn,
      }),
    ).rejects.toThrow('notarize failed');
    expect(stapleFn).not.toHaveBeenCalled();
  });
});

describe('notarizeAndStapleDMGs', () => {
  test('only processes .dmg artifacts', async () => {
    const notarizeFn = vi.fn().mockResolvedValue(undefined);
    const stapleFn = vi.fn();

    await notarizeAndStapleDMGs(
      [
        '/out/make/Install Ouijit.dmg',
        '/out/make/zip/darwin/arm64/ouijit-darwin-arm64.zip',
        '/out/make/ouijit-1.0.deb',
      ],
      {
        env: { APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I', HOME: '/home/runner' },
        notarizeFn,
        stapleFn,
      },
    );

    expect(notarizeFn).toHaveBeenCalledTimes(1);
    expect(notarizeFn).toHaveBeenCalledWith(expect.objectContaining({ appPath: '/out/make/Install Ouijit.dmg' }));
    expect(stapleFn).toHaveBeenCalledTimes(1);
    expect(stapleFn).toHaveBeenCalledWith('/out/make/Install Ouijit.dmg');
  });

  test('is a no-op when SKIP_NOTARIZE is set', async () => {
    const notarizeFn = vi.fn();
    const stapleFn = vi.fn();

    await notarizeAndStapleDMGs(['/out/make/Install Ouijit.dmg'], {
      env: { SKIP_NOTARIZE: '1' },
      notarizeFn,
      stapleFn,
    });

    expect(notarizeFn).not.toHaveBeenCalled();
    expect(stapleFn).not.toHaveBeenCalled();
  });

  test('is a no-op when there are no DMG artifacts', async () => {
    const notarizeFn = vi.fn();
    const stapleFn = vi.fn();

    await notarizeAndStapleDMGs(['/out/make/ouijit.zip', '/out/make/ouijit.deb'], {
      env: { APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I', HOME: '/home/runner' },
      notarizeFn,
      stapleFn,
    });

    expect(notarizeFn).not.toHaveBeenCalled();
    expect(stapleFn).not.toHaveBeenCalled();
  });

  test('falls back to keychain profile when CI credentials are absent', async () => {
    const notarizeFn = vi.fn().mockResolvedValue(undefined);
    const stapleFn = vi.fn();

    await notarizeAndStapleDMGs(['/out/make/Install Ouijit.dmg'], {
      env: {},
      notarizeFn,
      stapleFn,
    });

    expect(notarizeFn).toHaveBeenCalledWith({
      appPath: '/out/make/Install Ouijit.dmg',
      keychainProfile: 'ouijit-notarize',
    });
  });

  test('notarizes multiple DMGs in sequence', async () => {
    const callOrder: string[] = [];
    const notarizeFn = vi.fn().mockImplementation(async ({ appPath }: { appPath: string }) => {
      callOrder.push(`notarize:${appPath}`);
    });
    const stapleFn = vi.fn().mockImplementation((p: string) => {
      callOrder.push(`staple:${p}`);
    });

    await notarizeAndStapleDMGs(['/out/a.dmg', '/out/b.dmg'], {
      env: { APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I', HOME: '/h' },
      notarizeFn,
      stapleFn,
    });

    // Each DMG is notarized then stapled before the next one starts.
    expect(callOrder).toEqual(['notarize:/out/a.dmg', 'staple:/out/a.dmg', 'notarize:/out/b.dmg', 'staple:/out/b.dmg']);
  });
});
