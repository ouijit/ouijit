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

export interface LimaConfig {
  name: string;
  cpus: number;
  memoryGiB: number;
  diskGiB: number;
  mounts: LimaMount[];
  provisionScript: string;
  networkMode: 'vzNAT' | 'none';
}

export interface SandboxStatus {
  available: boolean;
  vmStatus: 'Running' | 'Stopped' | 'NotCreated' | 'Unavailable';
  instanceName?: string;
  memory?: number;
  disk?: number;
}
