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

export interface SandboxStatus {
  available: boolean;
  vmStatus: 'Running' | 'Stopped' | 'Broken' | 'NotCreated' | 'Unavailable';
  instanceName?: string;
  memory?: number;
  disk?: number;
}
