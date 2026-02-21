import { stopAllInstances } from './manager';
import { cleanupSandboxPtys } from './spawn';

export { spawnSandboxedPty, isSandboxPty, writeSandboxPty, resizeSandboxPty, killSandboxPty } from './spawn';

/**
 * Clean up: kill sandboxed PTYs and stop all running ouijit VMs.
 * Synchronous so it completes before the process exits.
 */
export function cleanup(): void {
  cleanupSandboxPtys();
  stopAllInstances();
}
