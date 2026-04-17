import { describe, test, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ouijit-test' } }));

import { buildLimactlHostEnv } from '../lima/spawn';

describe('buildLimactlHostEnv', () => {
  test('forwards allowlisted keys', () => {
    const env = buildLimactlHostEnv({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/me',
      USER: 'me',
      SHELL: '/bin/zsh',
      LANG: 'en_US.UTF-8',
    });
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/Users/me');
    expect(env.USER).toBe('me');
    expect(env.SHELL).toBe('/bin/zsh');
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  test('always sets TERM and LIMA_HOME', () => {
    const env = buildLimactlHostEnv({});
    expect(env.TERM).toBe('xterm-256color');
    expect(env.LIMA_HOME).toBeTruthy();
  });

  test.each([
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GITHUB_TOKEN',
    'NPM_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'HISTFILE',
    'SSH_CONNECTION',
  ])('drops secret-like var %s', (key) => {
    const env = buildLimactlHostEnv({ [key]: 'sensitive' });
    expect(env[key]).toBeUndefined();
  });

  test('omits unset allowlisted keys', () => {
    const env = buildLimactlHostEnv({ PATH: '/usr/bin' });
    expect(env.HOME).toBeUndefined();
    expect(env.USER).toBeUndefined();
  });
});
