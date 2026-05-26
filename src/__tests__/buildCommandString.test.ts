import { describe, it, expect } from 'vitest';
import { buildCommandString, buildCommandShellArgs } from '../ptyManager';

/**
 * Regression: OUIJIT_* values must not be textually interpolated into the
 * hook/start command string. They are passed to the PTY as real environment
 * variables, so the shell expands $VAR itself. Pre-substituting raw values
 * splices shell metacharacters (backticks, $(), quotes) into the command,
 * which the shell then re-evaluates.
 *
 * Proven case: task name `Add `.DS_Store` in .gitignore` with start
 * command `codex "$OUIJIT_TASK_NAME"` produced `zsh: command not found:
 * .DS_Store` — the backticks in the task name were executed.
 */
describe('buildCommandString', () => {
  it('returns an empty string when no command is given', () => {
    expect(buildCommandString(undefined, undefined)).toBe('');
    expect(buildCommandString(undefined, { OUIJIT_TASK_NAME: 'x' })).toBe('');
  });

  it('does not substitute $OUIJIT_* tokens — the shell expands them as real env vars', () => {
    const command = 'codex "$OUIJIT_TASK_NAME"';
    const env = { OUIJIT_TASK_NAME: 'Add `.DS_Store` in .gitignore' };

    const result = buildCommandString(command, env);

    // The token must survive verbatim so the shell expands the env var.
    expect(result).toBe('codex "$OUIJIT_TASK_NAME"');
    // The raw value (with backticks) must never appear in the command text.
    expect(result).not.toContain('.DS_Store');
    expect(result).not.toContain('`');
  });

  it('does not splice values containing $() command substitution', () => {
    const command = 'run "$OUIJIT_TASK_NAME"';
    const env = { OUIJIT_TASK_NAME: 'fix $(rm -rf /) bug' };

    const result = buildCommandString(command, env);

    expect(result).toBe('run "$OUIJIT_TASK_NAME"');
    expect(result).not.toContain('$(rm');
  });

  it('does not splice values containing quotes', () => {
    const command = 'echo "$OUIJIT_TASK_NAME"';
    const env = { OUIJIT_TASK_NAME: `it's a "quoted" name` };

    const result = buildCommandString(command, env);

    expect(result).toBe('echo "$OUIJIT_TASK_NAME"');
  });

  it('leaves commands without OUIJIT_* tokens untouched', () => {
    expect(buildCommandString('npm run dev', { OUIJIT_TASK_NAME: 'x' })).toBe('npm run dev');
  });
});

/**
 * The startup command is spliced into the shell's `-c` script as shell *code*
 * the shell must parse — not a data string. It must NOT be quote-escaped:
 * `'\''`-escaping (an idiom only valid inside an enclosing single-quoted
 * string) corrupts any command containing a single quote into an unterminated
 * quote, since the command is interpolated unquoted.
 */
describe('buildCommandShellArgs', () => {
  it('splices the command into the zsh -c script verbatim', () => {
    const args = buildCommandShellArgs("echo 'hello world'", '/bin/zsh', '/tmp/integration');

    expect(args[0]).toBe('-ic');
    expect(args[1]).toContain("echo 'hello world'");
    // The `'\''` escape idiom must never appear — it is invalid here.
    expect(args[1]).not.toContain("'\\''");
  });

  it('splices the command into the bash -c script verbatim', () => {
    const args = buildCommandShellArgs("echo 'hi'", '/bin/bash', '/tmp/integration');

    expect(args[0]).toBe('-ic');
    expect(args[1]).toContain("echo 'hi'");
    expect(args[1]).not.toContain("'\\''");
  });

  it('preserves a $OUIJIT_* token so the shell expands it as a real env var', () => {
    const args = buildCommandShellArgs('codex "$OUIJIT_TASK_NAME"', '/bin/zsh', '/tmp/integration');

    expect(args[1]).toContain('codex "$OUIJIT_TASK_NAME"');
  });

  it('keeps the command intact for non-zsh/bash shells', () => {
    const args = buildCommandShellArgs("fish_cmd 'arg'", '/usr/bin/fish', '/tmp/integration');

    expect(args[0]).toBe('-ic');
    expect(args[1]).toContain("fish_cmd 'arg'");
    expect(args[1]).toContain('exec /usr/bin/fish');
  });

  // exitAfterCommand: spawn for one-shot terminals (currently the done-hook
  // terminal) so the PTY exits with the command's real exit code instead of
  // dropping into an interactive shell — required for autoCloseOnSuccess and
  // the success/error status to fire.
  describe('exitAfterCommand', () => {
    it('omits the exec into interactive shell for zsh', () => {
      const args = buildCommandShellArgs('echo hi', '/bin/zsh', '/tmp/integration', true);
      expect(args[1]).toContain('echo hi');
      expect(args[1]).not.toContain('exec /bin/zsh');
      expect(args[1]).not.toContain('exec zsh');
    });

    it('omits the exec into interactive shell for bash', () => {
      const args = buildCommandShellArgs('echo hi', '/bin/bash', '/tmp/integration', true);
      expect(args[1]).toContain('echo hi');
      expect(args[1]).not.toContain('exec bash');
    });

    it('omits the exec into interactive shell for non-zsh/bash shells', () => {
      const args = buildCommandShellArgs('echo hi', '/usr/bin/fish', '/tmp/integration', true);
      expect(args[1]).toContain('echo hi');
      expect(args[1]).not.toContain('exec /usr/bin/fish');
    });

    it('default (exitAfterCommand false) still drops into the interactive shell', () => {
      const args = buildCommandShellArgs('echo hi', '/bin/zsh', '/tmp/integration');
      expect(args[1]).toContain('exec /bin/zsh');
    });
  });

  // Subshell wrapping isolates the user command from our outer zsh/bash so
  // that an explicit `exit` builtin terminates only the subshell. Without it,
  // a hook like `echo hi; exit 1` would nuke the outer shell before we could
  // exec into the interactive one — the user would never see a usable shell
  // on failure.
  describe('subshell wrapping', () => {
    it('wraps the command in a subshell for zsh', () => {
      const args = buildCommandShellArgs('echo hi; exit 1', '/bin/zsh', '/tmp/integration');
      expect(args[1]).toContain('(echo hi; exit 1)');
    });

    it('wraps the command in a subshell for bash', () => {
      const args = buildCommandShellArgs('echo hi; exit 1', '/bin/bash', '/tmp/integration');
      expect(args[1]).toContain('(echo hi; exit 1)');
    });

    it('still wraps when exitAfterCommand is set', () => {
      const args = buildCommandShellArgs('echo hi; exit 1', '/bin/zsh', '/tmp/integration', true);
      expect(args[1]).toContain('(echo hi; exit 1)');
    });
  });
});
