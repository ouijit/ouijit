import * as path from 'node:path';

/**
 * Package-manager cache environment for a sandboxed spawn.
 *
 * nono's agent profile grants the language toolchains read-only, so a tool
 * whose cache lives in a home dotdir (npm -> ~/.npm, etc.) fails to write it
 * (`EPERM`) even though installing into the project itself is allowed. Rather
 * than grant those dotdirs writable — which would co-mingle a writable path
 * with credentials and installed binaries — we point each tool's cache at a
 * per-project directory Ouijit already grants read+write. The install then
 * writes only where it is already allowed, widening no boundary.
 *
 * Only *cache* variables are set here — never config, credential, or binary
 * locations (e.g. not `CARGO_HOME`, which would relocate `~/.cargo/credentials`
 * and `~/.cargo/bin` too). A tool whose cache already sits in a writable
 * location works unchanged; redirecting it here is harmless.
 *
 * These are injected via `prepare()`, so a user's own rc-level override still
 * wins (the shell sources its rc after the process env is set).
 *
 * Pure (no fs) so it is unit-testable; the provider resolves and creates the
 * root and passes it in.
 */
export function sandboxCacheEnv(cacheRoot: string): Record<string, string> {
  const sub = (name: string): string => path.join(cacheRoot, name);
  return {
    npm_config_cache: sub('npm'),
    YARN_CACHE_FOLDER: sub('yarn'),
    PIP_CACHE_DIR: sub('pip'),
    UV_CACHE_DIR: sub('uv'),
    DENO_DIR: sub('deno'),
    BUN_INSTALL_CACHE: sub('bun'),
    GOCACHE: sub('go-build'),
    GOMODCACHE: sub('go-mod'),
  };
}
