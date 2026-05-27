import { describe, test, expect } from 'vitest';
import { ZSH_INTEGRATION, BASH_INTEGRATION } from '../hookServer';

/**
 * The shell-integration scripts emit the OSC 133 prompt-mark sequences so the
 * renderer can track terminal state:
 *   - ;A at each prompt start (idle, ready for input)
 *   - ;C just before a command runs (busy)
 *   - ;D;<exit> after a command finishes (done, with exit code)
 * Drives the status dot, autoCloseOnSuccess, and command-running detection.
 * Pinning the contents here so a regression breaks the build, not just the
 * next person's done hook.
 */

describe('zsh shell integration', () => {
  test('defines the exit-code precmd hook', () => {
    expect(ZSH_INTEGRATION).toContain('_ouijit_emit_exit_code()');
    expect(ZSH_INTEGRATION).toContain('local code=$?');
    expect(ZSH_INTEGRATION).toContain('printf "\\033]133;D;%d\\007"');
  });

  test('first prompt is suppressed (no command has run yet)', () => {
    expect(ZSH_INTEGRATION).toContain('if [ -n "$_OUIJIT_HAS_RUN" ]');
    expect(ZSH_INTEGRATION).toContain('_OUIJIT_HAS_RUN=1');
  });

  test('hook runs first so $? still reflects the user command, not later precmds', () => {
    expect(ZSH_INTEGRATION).toContain('precmd_functions=(_ouijit_emit_exit_code $precmd_functions)');
  });

  test('emits OSC 133;A on every prompt (including the first)', () => {
    expect(ZSH_INTEGRATION).toContain('printf "\\033]133;A\\007"');
  });

  test('emits OSC 133;C via preexec hook before each command', () => {
    expect(ZSH_INTEGRATION).toContain('_ouijit_emit_command_start()');
    expect(ZSH_INTEGRATION).toContain('printf "\\033]133;C\\007"');
    expect(ZSH_INTEGRATION).toContain('preexec_functions+=(_ouijit_emit_command_start)');
  });

  test('emits initial exit code passed via OUIJIT_INITIAL_EXIT across the exec', () => {
    expect(ZSH_INTEGRATION).toContain('if [ -n "${OUIJIT_INITIAL_EXIT-}" ]');
    expect(ZSH_INTEGRATION).toContain('printf "\\033]133;D;%d\\007" "$OUIJIT_INITIAL_EXIT"');
    expect(ZSH_INTEGRATION).toContain('unset OUIJIT_INITIAL_EXIT');
  });
});

describe('bash shell integration', () => {
  test('defines the exit-code prompt-command hook', () => {
    expect(BASH_INTEGRATION).toContain('_ouijit_emit_exit_code()');
    expect(BASH_INTEGRATION).toContain('local code=$?');
    expect(BASH_INTEGRATION).toContain('printf "\\033]133;D;%d\\007"');
  });

  test('first prompt is suppressed', () => {
    expect(BASH_INTEGRATION).toContain('if [ -n "$_OUIJIT_HAS_RUN" ]');
    expect(BASH_INTEGRATION).toContain('_OUIJIT_HAS_RUN=1');
  });

  test('hook is prepended to PROMPT_COMMAND so $? still reflects the user command', () => {
    expect(BASH_INTEGRATION).toContain('PROMPT_COMMAND="_ouijit_emit_exit_code; $PROMPT_COMMAND"');
  });

  test('emits OSC 133;A on every prompt (including the first)', () => {
    expect(BASH_INTEGRATION).toContain('printf "\\033]133;A\\007"');
  });

  test('emits OSC 133;C via PS0 before each command (bash 4.4+)', () => {
    expect(BASH_INTEGRATION).toContain('PS0=\'\\[\\e]133;C\\a\\]\'"$PS0"');
  });

  test('emits initial exit code passed via OUIJIT_INITIAL_EXIT across the exec', () => {
    expect(BASH_INTEGRATION).toContain('if [ -n "${OUIJIT_INITIAL_EXIT-}" ]');
    expect(BASH_INTEGRATION).toContain('printf "\\033]133;D;%d\\007" "$OUIJIT_INITIAL_EXIT"');
    expect(BASH_INTEGRATION).toContain('unset OUIJIT_INITIAL_EXIT');
  });
});
