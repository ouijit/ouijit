export interface LimaInstance {
  name: string;
  status: 'Running' | 'Stopped' | 'Broken' | 'NotFound';
  cpus: number;
  memory: number;
  disk: number;
  mounts: LimaMount[];
}

export interface LimaMount {
  hostPath: string;
  guestPath: string;
  writable: boolean;
}

/**
 * VM-shaped status for the Lima provider. The cross-provider, provider-neutral
 * status type is `SandboxProviderStatus` in `src/sandbox/types.ts`.
 */
export interface LimaStatus {
  available: boolean;
  vmStatus: 'Running' | 'Stopped' | 'Broken' | 'NotCreated' | 'Unavailable';
  instanceName?: string;
  memory?: number;
  disk?: number;
}
