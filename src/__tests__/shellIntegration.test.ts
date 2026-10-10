import { describe, it, expect } from 'vitest';
import { resolveShellIntegration } from '../shellIntegration';

const DIR = '/tmp/integration';

const launch = (shell: string, command: string, zdotdir?: string) =>
  resolveShellIntegration(shell).launch({ shell, integrationDir: DIR, command, zdotdir });

describe('resolveShellIntegration', () => {
  it('selects providers by shell path, falling back for unknown shells', () => {
    expect(resolveShellIntegration('/bin/zsh').id).toBe('zsh');
    expect(resolveShellIntegration('/opt/homebrew/bin/bash').id).toBe('bash');
    expect(resolveShellIntegration('/usr/bin/fish').id).toBe('fish');
    expect(resolveShellIntegration('/usr/bin/nu').id).toBe('posix');
  });

  it('marks zsh/bash/fish integrated and the fallback not (drives the limited-support notice)', () => {
    expect(resolveShellIntegration('/bin/zsh').isIntegrated).toBe(true);
    expect(resolveShellIntegration('/bin/bash').isIntegrated).toBe(true);
    expect(resolveShellIntegration('/usr/bin/fish').isIntegrated).toBe(true);
    expect(resolveShellIntegration('/usr/bin/nu').isIntegrated).toBe(false);
  });
});

describe('launch', () => {
  it('hands an integrated shell its startup command verbatim, in the env', () => {
    const command = `echo 'hello world'; codex "$OUIJIT_TASK_NAME"`;
    for (const shell of ['/bin/zsh', '/bin/bash', '/usr/bin/fish']) {
      const { file, env } = launch(shell, command);
      expect(file).toBe(shell);
      expect(env?.OUIJIT_STARTUP_COMMAND).toBe(command);
      expect(launch(shell, '').env?.OUIJIT_STARTUP_COMMAND).toBeUndefined();
    }
  });

  it('points zsh at our ZDOTDIR and stashes the original', () => {
    expect(launch('/bin/zsh', '', '/home/u/.zsh')).toEqual({
      file: '/bin/zsh',
      args: [],
      env: { ZDOTDIR: '/tmp/integration/zsh', OUIJIT_ZSH_ZDOTDIR: '/home/u/.zsh' },
    });
    expect(launch('/bin/zsh', '').env?.OUIJIT_ZSH_ZDOTDIR).toBe('');
  });

  it('loads the bash and fish integration through their own startup flags', () => {
    expect(launch('/bin/bash', 'claude').args).toEqual([
      '--init-file',
      '/tmp/integration/ouijit-bash-integration.bash',
    ]);
    expect(launch('/usr/bin/fish', 'claude').args).toEqual([
      '-C',
      `source '/tmp/integration/ouijit-fish-integration.fish'`,
    ]);
  });

  it('runs an unknown shell’s startup command under /bin/sh, then execs into the shell', () => {
    const { file, args } = launch('/usr/bin/nu', "echo 'hi'");
    expect(file).toBe('/bin/sh');
    expect(args).toEqual(['-c', `export PATH="$OUIJIT_WRAPPER_DIR:$PATH"; (echo 'hi'); exec /usr/bin/nu`]);
    expect(launch('/usr/bin/nu', '')).toEqual({ file: '/usr/bin/nu', args: [] });
  });
});
