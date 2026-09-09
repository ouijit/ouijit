import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetCacheForTesting, getGlobalSetting, setGlobalSetting } from '../db';
import {
  LINEAR_CREDENTIAL_KEY,
  LINEAR_ENV_VAR,
  canStoreCredential,
  readCredential,
  writeCredential,
} from '../linear/credentials';

/**
 * The OS keychain is the boundary, so it is what the fake stands in for. It
 * round-trips and reports availability, which is the whole contract the
 * credential store depends on.
 */
const keychain = { available: true };

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('encrypted:')) throw new Error('not ours');
      return text.slice('encrypted:'.length);
    },
  },
  app: { getPath: () => '/tmp' },
}));

beforeEach(() => {
  _resetCacheForTesting();
  keychain.available = true;
  delete process.env[LINEAR_ENV_VAR];
});

afterEach(() => {
  delete process.env[LINEAR_ENV_VAR];
});

describe('where the Linear API key lives', () => {
  test('a stored key round-trips, and clearing it leaves nothing behind', async () => {
    expect(await writeCredential('lin_api_secret')).toEqual({ success: true });
    expect(await readCredential()).toEqual({ apiKey: 'lin_api_secret', storage: 'keychain' });

    // What lands in the database is the ciphertext, base64, and never the key.
    const stored = await getGlobalSetting(LINEAR_CREDENTIAL_KEY);
    expect(stored).not.toContain('lin_api_secret');
    expect(Buffer.from(stored!, 'base64').toString('utf8')).toBe('encrypted:lin_api_secret');

    await writeCredential('');
    expect(await readCredential()).toBeNull();
  });

  /**
   * Linux with no keyring. Writing a workspace-wide credential into a plain
   * SQLite row is the thing this must not do, so it refuses and says what to
   * do instead.
   */
  test('with no keychain the key is refused, and the environment answers instead', async () => {
    keychain.available = false;
    expect(canStoreCredential()).toBe(false);

    const result = await writeCredential('lin_api_secret');
    expect(result.success).toBe(false);
    expect(result.error).toContain(LINEAR_ENV_VAR);
    expect(await getGlobalSetting(LINEAR_CREDENTIAL_KEY)).toBeUndefined();

    process.env[LINEAR_ENV_VAR] = 'lin_api_from_env';
    expect(await readCredential()).toEqual({ apiKey: 'lin_api_from_env', storage: 'environment' });
  });

  /**
   * A key encrypted under a keychain this machine no longer has. Saying it is
   * unreadable beats every later call failing as "unauthorized".
   */
  test('a key that cannot be decrypted falls through to the environment', async () => {
    await writeCredential('lin_api_secret');
    // Replace the stored ciphertext with something this keychain did not write.
    await setGlobalSetting(LINEAR_CREDENTIAL_KEY, Buffer.from('someone-elses', 'utf8').toString('base64'));

    expect(await readCredential()).toBeNull();

    process.env[LINEAR_ENV_VAR] = 'lin_api_from_env';
    expect(await readCredential()).toEqual({ apiKey: 'lin_api_from_env', storage: 'environment' });
  });
});
