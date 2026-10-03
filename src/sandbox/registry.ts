import type { SandboxBackendId, SandboxProviderId } from './types';
import type { SandboxProvider } from './provider';

/**
 * Central registry of sandbox backends, populated by `registerSandboxProviders`
 * during main-process bootstrap — before any PTY spawn or worktree op can
 * resolve a backend out of it.
 */
const providers = new Map<SandboxBackendId, SandboxProvider>();

export function registerSandboxProvider(provider: SandboxProvider): void {
  if (providers.has(provider.id)) {
    throw new Error(`Sandbox provider already registered: ${provider.id}`);
  }
  providers.set(provider.id, provider);
}

/** Resolve a provider by id. Returns undefined for 'none' or an unknown id. */
export function getSandboxProvider(id: SandboxProviderId | undefined): SandboxProvider | undefined {
  if (!id || id === 'none') return undefined;
  return providers.get(id);
}

export function listSandboxProviders(): SandboxProvider[] {
  return Array.from(providers.values());
}

export function cleanupSandboxProviders(): void {
  for (const provider of providers.values()) {
    provider.cleanup();
  }
}

/** Test-only: clear the registry between tests. */
export function _resetSandboxRegistryForTesting(): void {
  providers.clear();
}
