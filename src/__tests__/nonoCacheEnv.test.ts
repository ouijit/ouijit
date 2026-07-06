import { describe, test, expect } from 'vitest';
import { sandboxCacheEnv } from '../sandbox/nono/cacheEnv';

describe('sandboxCacheEnv', () => {
  test('redirects only package-manager caches under the granted root, never credentials/binaries', () => {
    const root = '/data/sandbox-cache/abc123';
    const env = sandboxCacheEnv(root);
    // Every supported package manager's cache points at a subdir of the root.
    expect(env).toEqual({
      npm_config_cache: `${root}/npm`,
      YARN_CACHE_FOLDER: `${root}/yarn`,
      PIP_CACHE_DIR: `${root}/pip`,
      UV_CACHE_DIR: `${root}/uv`,
      DENO_DIR: `${root}/deno`,
      BUN_INSTALL_CACHE: `${root}/bun`,
      GOCACHE: `${root}/go-build`,
      GOMODCACHE: `${root}/go-mod`,
    });
    // Safety: only caches are relocated. CARGO_HOME would move ~/.cargo's
    // credentials + bin too, so it (and any credential/home var) must stay out,
    // and nothing may escape the granted root.
    for (const [key, value] of Object.entries(env)) {
      expect(key).not.toMatch(/CARGO_HOME|CREDENTIAL|TOKEN|_HOME$/i);
      expect(value.startsWith(`${root}/`)).toBe(true);
    }
  });
});
