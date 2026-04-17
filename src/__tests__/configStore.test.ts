import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  generateDefaultConfig,
  resolveEnvVars,
  validateYaml,
  getConfigPath,
  readUserConfig,
  writeUserConfig,
  ensureConfig,
  deleteConfig,
  mergeConfig,
} from '../lima/configStore';

describe('configStore', () => {
  describe('generateDefaultConfig', () => {
    test('produces valid YAML', () => {
      const yaml = generateDefaultConfig();
      expect(validateYaml(yaml)).toBeNull();
    });

    test('includes expected fields', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('cpus: 2');
      expect(yaml).toContain('memory: 4GiB');
      expect(yaml).toContain('disk: 50GiB');
      expect(yaml).toContain('ubuntu-24.04');
      expect(yaml).toContain('provision');
      expect(yaml).toContain('apt-get install');
    });

    test('installs the overlay helper at /usr/local/sbin/ouijit-overlay-helper', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('/usr/local/sbin/ouijit-overlay-helper');
      expect(yaml).toContain('OUIJIT_HELPER_EOF');
    });

    test('writes a narrow sudoers rule that only grants the overlay helper', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('/etc/sudoers.d/99-ouijit');
      expect(yaml).toContain('NOPASSWD: /usr/local/sbin/ouijit-overlay-helper');
      // Strip any broader NOPASSWD:ALL rule that Lima / cloud-init may install,
      // scanning across all files in /etc/sudoers.d rather than a hardcoded list.
      expect(yaml).toContain('/etc/sudoers.d/*');
      expect(yaml).toContain('NOPASSWD:[[:space:]]*ALL');
      // visudo validation after edit so a botched strip doesn't lock sudo out.
      expect(yaml).toMatch(/visudo -cf "\$f"/);
    });

    test('installs + enables the egress firewall systemd unit', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('/usr/local/sbin/ouijit-firewall');
      expect(yaml).toContain('/etc/systemd/system/ouijit-firewall.service');
      expect(yaml).toContain('systemctl enable ouijit-firewall.service');
    });

    test('defaults network policy to strict', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('/etc/ouijit/network-policy');
      expect(yaml).toMatch(/echo strict > \/etc\/ouijit\/network-policy/);
    });

    test('firewall script drops outbound by default and permits host.lima.internal', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('iptables -P OUTPUT DROP');
      expect(yaml).toContain('host.lima.internal');
      expect(yaml).toContain('iptables -A OUTPUT -o lo -j ACCEPT');
    });

    test('firewall mirrors the DROP policy to IPv6 so dual-stack guests cannot bypass', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('ip6tables -P OUTPUT DROP');
      expect(yaml).toContain('ip6tables -A OUTPUT -o lo -j ACCEPT');
    });

    test('firewall has a /proc/net/route fallback for the gateway', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('/proc/net/route');
      // Final fallback to the VZ default so the firewall never ends up fully open.
      expect(yaml).toContain('192.168.5.2');
    });

    test('firewall honors a per-VM opt-out via /etc/ouijit/network-policy', () => {
      const yaml = generateDefaultConfig();
      expect(yaml).toContain('POLICY_FILE="/etc/ouijit/network-policy"');
      expect(yaml).toContain('policy=open, leaving default networking');
    });
  });

  describe('resolveEnvVars', () => {
    test('resolves existing env vars', () => {
      vi.stubEnv('TEST_VAR_123', 'hello');
      const { resolved, unresolved } = resolveEnvVars('value: ${TEST_VAR_123}');
      expect(resolved).toBe('value: hello');
      expect(unresolved).toEqual([]);
      vi.unstubAllEnvs();
    });

    test('reports unresolved vars and substitutes empty string', () => {
      const { resolved, unresolved } = resolveEnvVars('key: ${DEFINITELY_NOT_SET_XYZ}');
      expect(resolved).toBe('key: ');
      expect(unresolved).toEqual(['DEFINITELY_NOT_SET_XYZ']);
    });

    test('handles multiple vars', () => {
      vi.stubEnv('VAR_A', 'aaa');
      const { resolved, unresolved } = resolveEnvVars('${VAR_A} and ${MISSING_B}');
      expect(resolved).toBe('aaa and ');
      expect(unresolved).toEqual(['MISSING_B']);
      vi.unstubAllEnvs();
    });

    test('ignores non-matching patterns', () => {
      const { resolved, unresolved } = resolveEnvVars('plain text $NOT_A_REF');
      expect(resolved).toBe('plain text $NOT_A_REF');
      expect(unresolved).toEqual([]);
    });
  });

  describe('validateYaml', () => {
    test('returns null for valid YAML', () => {
      expect(validateYaml('key: value\nlist:\n  - item1\n  - item2')).toBeNull();
    });

    test('returns error for invalid YAML', () => {
      const error = validateYaml('key: value\n  bad indent: here');
      expect(error).toBeTruthy();
    });
  });

  describe('file operations', () => {
    const testProject = '/test/configstore-project';

    beforeEach(async () => {
      await deleteConfig(testProject);
    });

    test('readUserConfig returns null when no file exists', async () => {
      const result = await readUserConfig(testProject);
      expect(result).toBeNull();
    });

    test('writeUserConfig + readUserConfig round-trips', async () => {
      const yaml = 'cpus: 4\nmemory: 8GiB\n';
      await writeUserConfig(testProject, yaml);
      const result = await readUserConfig(testProject);
      expect(result).toBe(yaml);
    });

    test('ensureConfig creates default when missing', async () => {
      const yaml = await ensureConfig(testProject);
      expect(yaml).toContain('cpus');
      // Second call returns same content (already exists)
      const yaml2 = await ensureConfig(testProject);
      expect(yaml2).toBe(yaml);
    });

    test('ensureConfig returns existing config when present', async () => {
      const custom = 'cpus: 8\nmemory: 16GiB\n';
      await writeUserConfig(testProject, custom);
      const result = await ensureConfig(testProject);
      expect(result).toBe(custom);
    });

    test('deleteConfig removes the file', async () => {
      await writeUserConfig(testProject, 'cpus: 2\n');
      await deleteConfig(testProject);
      const result = await readUserConfig(testProject);
      expect(result).toBeNull();
    });

    test('deleteConfig is idempotent', async () => {
      // Should not throw when file doesn't exist
      await deleteConfig(testProject);
      await deleteConfig(testProject);
    });

    test('getConfigPath returns a deterministic path', () => {
      const path1 = getConfigPath(testProject);
      const path2 = getConfigPath(testProject);
      expect(path1).toBe(path2);
      expect(path1).toContain('sandbox-configs');
      expect(path1).toContain('ouijit-');
      expect(path1).toMatch(/\.yaml$/);
    });
  });

  describe('mergeConfig', () => {
    test('injects vmType', () => {
      const merged = mergeConfig('cpus: 2\n', '/test/project');
      expect(merged).toContain('vmType:');
    });

    test('appends project mounts', () => {
      const merged = mergeConfig('cpus: 2\n', '/test/project');
      expect(merged).toContain('/test/project');
      expect(merged).toContain('writable: false');
      expect(merged).toContain('writable: true');
    });

    test('preserves user mounts', () => {
      const userYaml = `mounts:
  - location: /custom/path
    mountPoint: /custom/path
    writable: true
`;
      const merged = mergeConfig(userYaml, '/test/project');
      expect(merged).toContain('/custom/path');
      expect(merged).toContain('/test/project');
    });

    test('preserves user fields', () => {
      const userYaml = 'cpus: 8\nmemory: 16GiB\ndisk: 200GiB\n';
      const merged = mergeConfig(userYaml, '/test/project');
      expect(merged).toContain('cpus: 8');
      expect(merged).toContain('memory: 16GiB');
      expect(merged).toContain('disk: 200GiB');
    });
  });
});
