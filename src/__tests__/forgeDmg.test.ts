import { describe, test, expect, vi } from 'vitest';
import { notarizeAndStapleArtifact, notarizeAndStapleDMGs } from '../../forge.dmg';

describe('notarizeAndStapleArtifact', () => {
  test('does not staple when notarize rejects', async () => {
    // Stapling a non-notarized artifact would produce a DMG that silently fails
    // Gatekeeper on a user's machine. The two steps must stay coupled.
    const notarizeFn = vi.fn().mockRejectedValue(new Error('notarize failed'));
    const stapleFn = vi.fn();
    await expect(
      notarizeAndStapleArtifact('/tmp/ouijit-darwin-arm64.dmg', {
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
    // Notarizing ZIPs or .deb files would fail loudly or waste Apple's rate limit.
    const notarizeFn = vi.fn().mockResolvedValue(undefined);
    const stapleFn = vi.fn();

    await notarizeAndStapleDMGs(
      [
        '/out/make/ouijit-darwin-arm64.dmg',
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
    expect(notarizeFn).toHaveBeenCalledWith(expect.objectContaining({ appPath: '/out/make/ouijit-darwin-arm64.dmg' }));
    expect(stapleFn).toHaveBeenCalledTimes(1);
  });

  test('honors SKIP_NOTARIZE for local builds without Apple credentials', async () => {
    const notarizeFn = vi.fn();
    const stapleFn = vi.fn();

    await notarizeAndStapleDMGs(['/out/make/ouijit-darwin-arm64.dmg'], {
      env: { SKIP_NOTARIZE: '1' },
      notarizeFn,
      stapleFn,
    });

    expect(notarizeFn).not.toHaveBeenCalled();
    expect(stapleFn).not.toHaveBeenCalled();
  });

  test('notarizes DMGs sequentially, not in parallel', async () => {
    // Parallel submissions risk Apple's rate limits and racey stapler behavior.
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

    expect(callOrder).toEqual(['notarize:/out/a.dmg', 'staple:/out/a.dmg', 'notarize:/out/b.dmg', 'staple:/out/b.dmg']);
  });
});
