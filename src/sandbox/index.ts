import { registerSandboxProvider } from './registry';
import { limaProvider } from '../lima/provider';
import { nonoProvider } from './nono/provider';
import { customProvider } from './custom/provider';

let registered = false;

/**
 * Must run during main-process bootstrap, before any PTY spawns. Idempotent, so
 * re-entry on window recreation is a no-op rather than a duplicate registration.
 */
export function registerSandboxProviders(): void {
  if (registered) return;
  registered = true;
  registerSandboxProvider(limaProvider);
  registerSandboxProvider(nonoProvider);
  registerSandboxProvider(customProvider);
}

export {
  getSandboxProvider,
  listSandboxProviders,
  listSessionOwners,
  findSessionOwner,
  cleanupSandboxProviders,
} from './registry';
