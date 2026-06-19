import { describe, it, expect } from 'vitest';
import { resolveShellIntegration } from '../shellIntegration';

const DIR = '/tmp/integration';

const launch = (shell: string, command: string, zdotdir?: string) =>
  resolveShellIntegration(shell).launch({ shell, integrationDir: DIR, command, zdotdir });

/**
 * The startup command is spliced into the bootstrap script as shell *code* the
 * shell must parse, not a data string. It must NOT be quote-escaped: the `'\''`
 * idiom is only valid inside an enclosing single-quoted string, and the command
 * is interpolated unquoted, so escaping would corrupt any command containing a
 * single quote into an unterminated quote.
 */
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

describe('zsh launch', () => {
  it('runs the bootstrap in zsh via -ic and execs back into zsh', () => {
    const { file, args } = launch('/bin/zsh', "echo 'hello world'");
    expect(file).toBe('/bin/zsh');
    expect(args[0]).toBe('-ic');
    expect(args[1]).toContain("echo 'hello world'");
    expect(args[1]).not.toContain("'\\''"); // command spliced verbatim, not escaped
    expect(args[1]).toContain('exec /bin/zsh');
  });

  it('preserves a $OUIJIT_* token so the shell expands it as a real env var', () => {
    const { args } = launch('/bin/zsh', 'codex "$OUIJIT_TASK_NAME"');
    expect(args[1]).toContain('codex "$OUIJIT_TASK_NAME"');
  });

  it('sets ZDOTDIR to our integration dir and stashes the original', () => {
    const { env } = launch('/bin/zsh', '', '/home/u/.zsh');
    expect(env).toEqual({ ZDOTDIR: '/tmp/integration/zsh', OUIJIT_ZSH_ZDOTDIR: '/home/u/.zsh' });
  });

  it('stashes an empty original ZDOTDIR when the user has none', () => {
    const { env } = launch('/bin/zsh', '');
    expect(env?.OUIJIT_ZSH_ZDOTDIR).toBe('');
  });

  it('launches a plain interactive shell when there is no command', () => {
    const { file, args } = launch('/bin/zsh', '');
    expect(file).toBe('/bin/zsh');
    expect(args).toEqual([]);
  });
});

describe('bash launch', () => {
  it('runs the bootstrap in bash via -ic and execs back with the rcfile', () => {
    const { file, args } = launch('/bin/bash', "echo 'hi'");
    expect(file).toBe('/bin/bash');
    expect(args[0]).toBe('-ic');
    expect(args[1]).toContain("echo 'hi'");
    expect(args[1]).toContain('exec bash --rcfile /tmp/integration/ouijit-bash-integration.bash');
  });

  it('uses --init-file when there is no command', () => {
    const { file, args } = launch('/bin/bash', '');
    expect(file).toBe('/bin/bash');
    expect(args).toEqual(['--init-file', '/tmp/integration/ouijit-bash-integration.bash']);
  });
});

/**
 * Regression for #223: fish can't parse our POSIX bootstrap (`export`, the
 * `(...)` subshell, `$?`). Running it via `fish -ic` produced shell errors and
 * tasks never started. The bootstrap must run under /bin/sh, which execs into
 * fish with the integration sourced via `-C`.
 */
describe('fish launch (#223)', () => {
  it('runs the bootstrap under /bin/sh, never fish -ic', () => {
    const { file, args } = launch('/usr/bin/fish', "fish_cmd 'arg'");
    expect(file).toBe('/bin/sh');
    expect(args[0]).toBe('-c');
    expect(args[0]).not.toBe('-ic');
    expect(args[1]).toContain("fish_cmd 'arg'");
    expect(args[1]).not.toContain("'\\''");
  });

  it('execs into fish and sources the fish integration after config.fish', () => {
    const { args } = launch('/opt/homebrew/bin/fish', 'claude');
    expect(args[1]).toContain(
      `exec /opt/homebrew/bin/fish -C "source '/tmp/integration/ouijit-fish-integration.fish'"`,
    );
  });

  it('sources the integration via -C when there is no command', () => {
    const { file, args } = launch('/usr/bin/fish', '');
    expect(file).toBe('/usr/bin/fish');
    expect(args).toEqual(['-C', `source '/tmp/integration/ouijit-fish-integration.fish'`]);
  });
});

describe('fallback launch (unknown shell)', () => {
  it('runs the bootstrap under /bin/sh and execs into the shell', () => {
    const { file, args } = launch('/usr/bin/nu', 'echo hi');
    expect(file).toBe('/bin/sh');
    expect(args[0]).toBe('-c');
    expect(args[1]).toContain('exec /usr/bin/nu');
  });

  it('launches the shell directly when there is no command', () => {
    const { file, args } = launch('/usr/bin/nu', '');
    expect(file).toBe('/usr/bin/nu');
    expect(args).toEqual([]);
  });
});

/**
 * The subshell isolates a stray `exit` to the command, and $? is captured into
 * OUIJIT_INITIAL_EXIT before the exec resets it (the integration script reads
 * it on first load and emits OSC 133;D). Ordering: command, then capture, then
 * exec.
 */
describe('bootstrap structure', () => {
  for (const shell of ['/bin/zsh', '/bin/bash', '/usr/bin/fish', '/usr/bin/nu']) {
    it(`wraps the command in a subshell and captures its exit code for ${shell}`, () => {
      const { args } = launch(shell, 'false');
      const script = args[args.length - 1];
      expect(script).toContain('(false)');
      expect(script).toContain('export OUIJIT_INITIAL_EXIT=$?');
      const cmdIdx = script.indexOf('(false)');
      const captureIdx = script.indexOf('OUIJIT_INITIAL_EXIT');
      const execIdx = script.indexOf('exec ');
      expect(cmdIdx).toBeLessThan(captureIdx);
      expect(captureIdx).toBeLessThan(execIdx);
    });
  }
});
