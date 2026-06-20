import { describe, it, expect } from 'vitest';
import { buildCommandString } from '../ptyManager';

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
