import * as os from 'node:os';
import * as path from 'node:path';
import type { LimaConfig, LimaMount } from './types';

/**
 * Generate a lima.yaml configuration string for a sandbox VM
 */
export function generateLimaYaml(config: LimaConfig): string {
  const mountsYaml = config.mounts
    .map(
      (m) =>
        `  - location: "${m.hostPath}"\n    mountPoint: "${m.guestPath}"\n    writable: ${m.writable}`
    )
    .join('\n');

  const networkYaml =
    config.networkMode === 'vzNAT'
      ? 'networks:\n  - vzNAT: true'
      : 'networks: []';

  return `# Ouijit Sandbox VM Configuration
# Auto-generated - do not edit directly

vmType: vz
arch: default

cpus: ${config.cpus}
memory: ${config.memoryGiB}GiB

images:
  - location: "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-arm64.img"
    arch: "aarch64"
  - location: "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img"
    arch: "x86_64"

mounts:
${mountsYaml}

provision:
  - mode: system
    script: |
      #!/bin/bash
      set -eux
      apt-get update
      apt-get install -y ${config.provisionScript}

${networkYaml}

ssh:
  loadDotSSHPubKeys: true
`;
}

/**
 * Build the default provision packages string
 */
export function defaultProvisionPackages(): string {
  return 'bash git curl wget nodejs npm python3 build-essential';
}

/**
 * Build mounts for a project.
 * Project root is read-only (for git access). Worktrees are writable (shared with host).
 * Mounted at their real host paths so all git paths resolve naturally.
 */
export function buildProjectMounts(projectPath: string): LimaMount[] {
  const projectName = path.basename(projectPath);
  const worktreeBaseDir = path.join(os.homedir(), 'Ouijit', 'worktrees', projectName);

  return [
    {
      hostPath: projectPath,
      guestPath: projectPath,
      writable: false,
    },
    {
      hostPath: worktreeBaseDir,
      guestPath: worktreeBaseDir,
      writable: true,
    },
  ];
}

/**
 * Build a full LimaConfig for a project
 */
export function buildLimaConfig(
  instanceName: string,
  projectPath: string,
  overrides?: { cpus?: number; memoryGiB?: number; networkMode?: 'vzNAT' | 'none' }
): LimaConfig {
  return {
    name: instanceName,
    cpus: overrides?.cpus ?? 2,
    memoryGiB: overrides?.memoryGiB ?? 4,
    mounts: buildProjectMounts(projectPath),
    provisionScript: defaultProvisionPackages(),
    networkMode: overrides?.networkMode ?? 'vzNAT',
  };
}

/**
 * Expand ~ to the user's home directory
 */
export function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return os.homedir() + p.slice(1);
  }
  return p;
}
