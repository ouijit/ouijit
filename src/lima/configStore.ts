import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { app } from 'electron';
import { stringify, parse } from 'yaml';
import { getInstanceName } from './manager';
import { buildProjectMounts } from './config';
import log from '../log';

const configLog = log.scope('limaConfig');

/** Directory within Electron userData where sandbox YAML configs are stored */
function getConfigDir(): string {
  return path.join(app.getPath('userData'), 'sandbox-configs');
}

/** Get the YAML config file path for a project */
export function getConfigPath(projectPath: string): string {
  const instanceName = getInstanceName(projectPath);
  return path.join(getConfigDir(), `${instanceName}.yaml`);
}

/** Check if a config file exists for this project */
export async function configExists(projectPath: string): Promise<boolean> {
  try {
    await fs.access(getConfigPath(projectPath));
    return true;
  } catch {
    return false;
  }
}

/** Generate a platform-appropriate default Lima YAML config */
export function generateDefaultConfig(): string {
  const isMac = os.platform() === 'darwin';

  const config: Record<string, unknown> = {
    cpus: 2,
    memory: '4GiB',
    disk: '50GiB',
    images: [
      {
        location: 'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-arm64.img',
        arch: 'aarch64',
      },
      {
        location: 'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img',
        arch: 'x86_64',
      },
    ],
    provision: [
      {
        mode: 'system',
        script:
          '#!/bin/bash\nset -eux -o pipefail\napt-get update\napt-get install -y bash git curl wget nodejs npm python3 build-essential\n',
      },
    ],
    networks: isMac ? [{ vzNAT: true }] : [],
    ssh: { loadDotSSHPubKeys: true },
  };

  return stringify(config);
}

/** Read the user's raw YAML config for a project. Returns null if no file exists. */
export async function readUserConfig(projectPath: string): Promise<string | null> {
  try {
    return await fs.readFile(getConfigPath(projectPath), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write the user's YAML config for a project.
 * Creates the sandbox-configs directory if it doesn't exist.
 */
export async function writeUserConfig(projectPath: string, yaml: string): Promise<void> {
  const configPath = getConfigPath(projectPath);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, yaml, 'utf-8');
  configLog.info('wrote sandbox config', { projectPath, configPath });
}

/** Delete the config file for a project */
export async function deleteConfig(projectPath: string): Promise<void> {
  try {
    await fs.unlink(getConfigPath(projectPath));
    configLog.info('deleted sandbox config', { projectPath });
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Ensure a default config exists for a project. Creates one if missing.
 * Returns the user config YAML string.
 */
export async function ensureConfig(projectPath: string): Promise<string> {
  const existing = await readUserConfig(projectPath);
  if (existing !== null) return existing;

  const defaultYaml = generateDefaultConfig();
  await writeUserConfig(projectPath, defaultYaml);
  return defaultYaml;
}

/**
 * Resolve ${VAR_NAME} references in a string from process.env.
 * Returns the resolved string and a list of unresolved variable names.
 */
export function resolveEnvVars(input: string): { resolved: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const resolved = input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      unresolved.push(varName);
      return '';
    }
    return value;
  });
  return { resolved, unresolved };
}

/**
 * Merge Ouijit-managed fields into a user config to produce the final Lima YAML.
 * Protected fields (vmType, mounts for project/worktree) are injected/appended.
 */
export function mergeConfig(userYaml: string, projectPath: string): string {
  const isMac = os.platform() === 'darwin';
  const userDoc = (parse(userYaml) as Record<string, unknown>) ?? {};

  // Inject protected fields
  userDoc.vmType = isMac ? 'vz' : 'qemu';

  // Merge mounts: user mounts + project mounts (project mounts always appended)
  const projectMounts = buildProjectMounts(projectPath).map((m) => ({
    location: m.hostPath,
    mountPoint: m.guestPath,
    writable: m.writable,
  }));
  const userMounts = Array.isArray(userDoc.mounts) ? (userDoc.mounts as Record<string, unknown>[]) : [];
  userDoc.mounts = [...userMounts, ...projectMounts];

  return stringify(userDoc);
}

/**
 * Get the full merged config for display in the editor.
 * Shows user fields + Ouijit-managed fields with comments.
 */
export async function getMergedConfigForDisplay(projectPath: string): Promise<string> {
  const userYaml = await ensureConfig(projectPath);
  const merged = mergeConfig(userYaml, projectPath);

  // Prepend a comment block explaining the managed fields
  const managedComment = [
    '# ── Ouijit-managed fields (read-only) ──────────────────────────',
    '# vmType and project mounts are injected automatically.',
    '# Edit the fields below to customize your sandbox.',
    '',
  ].join('\n');

  return managedComment + merged;
}

/**
 * Build the final YAML string for limactl create.
 * Merges user config with Ouijit fields and resolves env vars.
 */
export async function buildFinalConfig(projectPath: string): Promise<{ yaml: string; warnings: string[] }> {
  const userYaml = await ensureConfig(projectPath);
  const merged = mergeConfig(userYaml, projectPath);
  const { resolved, unresolved } = resolveEnvVars(merged);

  const warnings: string[] = [];
  if (unresolved.length > 0) {
    const msg = `Unresolved environment variables: ${unresolved.join(', ')}`;
    configLog.warn(msg, { projectPath, unresolved });
    warnings.push(msg);
  }

  return { yaml: resolved, warnings };
}

/**
 * Validate that a YAML string is syntactically valid.
 * Returns null if valid, or an error message if invalid.
 */
export function validateYaml(yaml: string): string | null {
  try {
    parse(yaml);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid YAML';
  }
}
