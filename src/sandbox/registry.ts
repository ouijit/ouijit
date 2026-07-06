import type { PtyId } from '../types';
import type { SandboxBackendId, SandboxProviderId } from './types';
import type { SandboxProvider, SessionOwnerSandboxProvider } from './provider';

/**
 * Central registry of sandbox backends. `pty.ts` and the sandbox IPC handlers
 * resolve providers here instead of importing Lima directly, which is what lets
 * a new backend (nono) drop in without touching the dispatch or Lima's
 * VM-specific machinery.
 */
const providers = new Map<SandboxBackendId, SandboxProvider>();

/**
 * Cached session-owner list. `findSessionOwner` runs on every PTY event (write
 * fires per keystroke), so we memoize the filtered list instead of rebuilding
 * two throwaway arrays each time. Invalidated whenever the registry changes.
 */
let sessionOwnersCache: SessionOwnerSandboxProvider[] | null = null;

export function registerSandboxProvider(provider: SandboxProvider): void {
  if (providers.has(provider.id)) {
    throw new Error(`Sandbox provider already registered: ${provider.id}`);
  }
  providers.set(provider.id, provider);
  sessionOwnersCache = null;
}

/** Resolve a provider by id. Returns undefined for 'none' or an unknown id. */
export function getSandboxProvider(id: SandboxProviderId | undefined): SandboxProvider | undefined {
  if (!id || id === 'none') return undefined;
  return providers.get(id);
}

export function listSandboxProviders(): SandboxProvider[] {
  return Array.from(providers.values());
}

export function listSessionOwners(): SessionOwnerSandboxProvider[] {
  if (sessionOwnersCache === null) {
    sessionOwnersCache = Array.from(providers.values()).filter(
      (p): p is SessionOwnerSandboxProvider => p.kind === 'session-owner',
    );
  }
  return sessionOwnersCache;
}

/** Find the session-owning provider that owns a given PTY, if any. */
export function findSessionOwner(ptyId: PtyId): SessionOwnerSandboxProvider | undefined {
  return listSessionOwners().find((p) => p.ownsPty(ptyId));
}

/** App-quit cleanup across all registered providers. */
export function cleanupSandboxProviders(): void {
  for (const provider of providers.values()) {
    provider.cleanup();
  }
}

/** Test-only: clear the registry between tests. */
export function _resetSandboxRegistryForTesting(): void {
  providers.clear();
  sessionOwnersCache = null;
}
