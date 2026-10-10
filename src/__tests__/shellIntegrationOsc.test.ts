import { describe, test, expect } from 'vitest';
import { ZSH_INTEGRATION, ZSH_ZSHRC, BASH_INTEGRATION, FISH_INTEGRATION } from '../shellIntegration';

/**
 * The shell-integration scripts emit OSC 133;D;<exit_code> after each command
 * so the renderer can detect a command's exit code without the PTY dying.
 * Drives the success/error status dot and autoCloseOnSuccess. Pinning the
 * contents of the integration scripts here so a regression breaks the build,
 * not just the next person's done hook.
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
    expect(ZSH_ZSHRC).toContain('precmd_functions=(_ouijit_emit_exit_code $precmd_functions');
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
    expect(BASH_INTEGRATION).toContain('PROMPT_COMMAND="_ouijit_emit_exit_code\n$PROMPT_COMMAND\n');
  });
});

describe('fish shell integration', () => {
  test('re-prepends the wrapper dir to PATH (after config.fish runs)', () => {
    expect(FISH_INTEGRATION).toContain('set -gx PATH $OUIJIT_WRAPPER_DIR $cleaned');
  });

  test('emits the exit code via a fish_postexec event handler', () => {
    expect(FISH_INTEGRATION).toContain('function _ouijit_emit_exit_code --on-event fish_postexec');
    // $status must be captured before printf clobbers it.
    expect(FISH_INTEGRATION).toContain('set -l code $status');
    expect(FISH_INTEGRATION).toContain('printf "\\033]133;D;%d\\007" $code');
  });
});
