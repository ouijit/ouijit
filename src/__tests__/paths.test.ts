import { describe, test, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { getUserDataPath, setUserDataPath, getDbPath } from '../paths';

describe('paths', () => {
  beforeEach(() => {
    // Reset to defaults by setting null (not exposed, but we can set a known path)
    setUserDataPath('');
  });

  test('getUserDataPath returns platform default when not overridden and set to empty', () => {
    // When set to empty string, getUserDataPath returns '' (falsy) so falls through to default
    // Actually empty string is falsy, so it returns default
    const result = getUserDataPath();
    if (process.platform === 'darwin') {
      expect(result).toBe(path.join(os.homedir(), 'Library', 'Application Support', 'ouijit'));
    } else {
      const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
      expect(result).toBe(path.join(configDir, 'ouijit'));
    }
  });

  test('setUserDataPath overrides the default', () => {
    setUserDataPath('/custom/path');
    expect(getUserDataPath()).toBe('/custom/path');
  });

  test('getDbPath returns ouijit.db within userData', () => {
    setUserDataPath('/custom/data');
    expect(getDbPath()).toBe('/custom/data/ouijit.db');
  });
});
