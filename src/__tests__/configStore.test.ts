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
