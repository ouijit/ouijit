import { registerSandboxProvider } from './registry';
import { limaProvider } from '../lima/provider';

let registered = false;

/**
 * Register every built-in sandbox backend. Called during main-process
 * bootstrap, before any PTY spawns. Idempotent so re-entry (e.g. window
 * recreation) is a no-op rather than a duplicate-registration error. Add new
 * providers here (e.g. nono).
 */
export function registerSandboxProviders(): void {
  if (registered) return;
  registered = true;
  registerSandboxProvider(limaProvider);
}

export {
  getSandboxProvider,
  listSandboxProviders,
  listSessionOwners,
  findSessionOwner,
  cleanupSandboxProviders,
} from './registry';
