import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Shell integration: one provider per shell.
 *
 * Ouijit shadows `claude`, `codex`, `ouijit`, etc. with wrapper scripts on a
 * private bin dir, and that dir must stay FIRST in PATH even after the user's
 * shell init files (.zshrc, .bashrc, config.fish) reorder it. It also wants the
 * shell to emit an OSC 133;D;<code> after each command so the renderer can read
 * exit codes without the PTY exiting.
 *
 * Both goals are inherently per-shell: the injection point (ZDOTDIR vs
 * --rcfile vs -C), the PATH re-prepend syntax, and the post-command hook
 * (precmd_functions vs PROMPT_COMMAND vs fish_postexec) all differ. Rather than
 * special-case each shell across spawnPty + installWrapper, each shell is a
 * {@link ShellIntegration} provider that owns its files and its launch recipe.
 * Unknown shells fall back to {@link posixFallbackIntegration}, which still
 * launches the shell (via /bin/sh) but provides no integration — fail open, so
 * a new/exotic shell degrades instead of erroring.
 */

/** Where shell integration scripts are written. */
export function getShellIntegrationDir(): string {
  return path.join(os.homedir(), '.config', 'Ouijit', 'shell-integration');
}

/** How to launch a PTY: the binary to exec, its argv, and env vars to add. */
export interface ShellLaunch {
  file: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ShellLaunchContext {
  /** Absolute path to the user's shell (from $SHELL). */
  shell: string;
  /** Directory the integration scripts live in. */
  integrationDir: string;
  /** Startup command to run before the interactive shell, or '' for none. */
  command: string;
  /** The user's current $ZDOTDIR, if any (zsh needs to restore it). */
  zdotdir?: string;
}

export interface ShellIntegration {
  /** Stable id for logging/tests. */
  id: string;
  /** Whether this provider handles the given shell path. */
  matches(shell: string): boolean;
  /** Write this shell's integration scripts into `integrationDir`. */
  installFiles(integrationDir: string): void;
  /** Build the spawn recipe for this shell. */
  launch(ctx: ShellLaunchContext): ShellLaunch;
}

// ── Shared bootstrap ─────────────────────────────────────────────────
//
// When a startup command is present we run it, capture its exit code across the
// `exec` into the interactive shell (which resets $?), and keep the wrapper dir
// first in PATH. This is POSIX sh — `export`, the `(...)` subshell, and `$?`
// are not portable to fish/nushell — so non-POSIX shells run it under /bin/sh
// (see fishIntegration / posixFallbackIntegration) rather than in-shell.

const WRAPPER_PATH_EXPORT = 'export PATH="$OUIJIT_WRAPPER_DIR:$PATH"';

/**
 * A POSIX bootstrap: re-prepend the wrapper dir, run `command` in a subshell so
 * a stray `exit` only kills the subshell, stash its exit code in
 * OUIJIT_INITIAL_EXIT (the integration scripts read it and emit OSC 133;D on
 * first load), then run `execTail` to become the interactive shell.
 */
function bootstrap(command: string, execTail: string): string {
  return `${WRAPPER_PATH_EXPORT}; (${command}); export OUIJIT_INITIAL_EXIT=$?; ${execTail}`;
}

// ── Shared script fragments ──────────────────────────────────────────

/**
 * Re-prepend the wrapper dir to PATH, removing any existing copies first.
 * bash/zsh compatible (uses `${PATH//.../}`). The leading/trailing-colon dance
 * makes the substitution match entries at the start/end of PATH too.
 */
const POSIX_PATH_REPREPEND = [
  'PATH=":$PATH:"',
  'PATH="${PATH//:$OUIJIT_WRAPPER_DIR:/:}"',
  'PATH="${PATH#:}"',
  'PATH="${PATH%:}"',
  'PATH="$OUIJIT_WRAPPER_DIR:$PATH"',
  'export PATH',
];

const indent = (lines: string[], pad: string): string[] => lines.map((line) => (line ? pad + line : line));

// ── zsh ──────────────────────────────────────────────────────────────

/** zsh ZDOTDIR bootstrap — written to shell-integration/zsh/.zshenv */
export const ZSH_ZSHENV = [
  '# Ouijit zsh integration — ZDOTDIR bootstrap',
  '# Restores original ZDOTDIR, sources user .zshenv, loads PATH fix.',
  'ZDOTDIR="$OUIJIT_ZSH_ZDOTDIR"',
  '[ -z "$ZDOTDIR" ] && unset ZDOTDIR',
  '',
  '# Source user .zshenv',
  'if [ -f "${ZDOTDIR:-$HOME}/.zshenv" ]; then',
  '  . "${ZDOTDIR:-$HOME}/.zshenv"',
  'fi',
  '',
  '# For interactive shells, load PATH fix',
  'if [[ -o interactive ]]; then',
  '  . "$OUIJIT_SHELL_INTEGRATION_DIR/ouijit-zsh-integration.zsh"',
  'fi',
  '',
].join('\n');

/** zsh PATH fix + command-exit signal — written to shell-integration/ouijit-zsh-integration.zsh */
export const ZSH_INTEGRATION = [
  '# Ouijit zsh integration — ensures wrapper dir stays first in PATH.',
  '_ouijit_fix_path() {',
  ...indent(POSIX_PATH_REPREPEND, '  '),
  '  # Self-remove after first invocation',
  '  precmd_functions=(${precmd_functions:#_ouijit_fix_path})',
  '  preexec_functions=(${preexec_functions:#_ouijit_fix_path})',
  '}',
  'precmd_functions+=(_ouijit_fix_path)',
  'preexec_functions+=(_ouijit_fix_path)',
  '',
  '# Emit OSC 133;D;<exit_code> after each command so the renderer can detect',
  "# the prior command's exit code without the PTY actually exiting. Skips the",
  '# very first prompt (no command has run yet). MUST be the first precmd so',
  '# $? still reflects the user command, not a downstream precmd hook.',
  '_ouijit_emit_exit_code() {',
  '  local code=$?',
  '  if [ -n "$_OUIJIT_HAS_RUN" ]; then',
  '    printf "\\033]133;D;%d\\007" "$code"',
  '  fi',
  '  _OUIJIT_HAS_RUN=1',
  '  return $code',
  '}',
  'precmd_functions=(_ouijit_emit_exit_code $precmd_functions)',
  '',
  '# When we exec into this shell from a one-off command (a hook script), the',
  '# subshell exit code is passed across the exec via OUIJIT_INITIAL_EXIT. Emit',
  '# OSC 133;D for it now so the renderer learns the result without waiting for',
  '# the user to type a command. The precmd hook above still skips its first',
  '# emission so this is the only signal for the initial command.',
  'if [ -n "${OUIJIT_INITIAL_EXIT-}" ]; then',
  '  printf "\\033]133;D;%d\\007" "$OUIJIT_INITIAL_EXIT"',
  '  unset OUIJIT_INITIAL_EXIT',
  'fi',
  '',
].join('\n');

const zshIntegration: ShellIntegration = {
  id: 'zsh',
  matches: (shell) => shell.endsWith('/zsh') || shell === 'zsh',
  installFiles(dir) {
    const zshDir = path.join(dir, 'zsh');
    fs.mkdirSync(zshDir, { recursive: true });
    fs.writeFileSync(path.join(zshDir, '.zshenv'), ZSH_ZSHENV, { mode: 0o644 });
    fs.writeFileSync(path.join(dir, 'ouijit-zsh-integration.zsh'), ZSH_INTEGRATION, { mode: 0o644 });
  },
  launch({ shell, integrationDir, command, zdotdir }) {
    // ZDOTDIR trick: zsh sources $ZDOTDIR/.zshenv first; ours restores the real
    // ZDOTDIR, sources the user's .zshenv, then registers the PATH-fix hooks.
    const env = {
      OUIJIT_ZSH_ZDOTDIR: zdotdir ?? '',
      ZDOTDIR: path.join(integrationDir, 'zsh'),
    };
    if (!command) return { file: shell, args: [], env };
    const execTail = `ZDOTDIR="$OUIJIT_SHELL_INTEGRATION_DIR/zsh" exec ${shell}`;
    return { file: shell, args: ['-ic', bootstrap(command, execTail)], env };
  },
};

// ── bash ─────────────────────────────────────────────────────────────

/** bash rcfile replacement — written to shell-integration/ouijit-bash-integration.bash */
export const BASH_INTEGRATION = [
  '# Ouijit bash integration — sources .bashrc then fixes PATH.',
  'if [ -f "$HOME/.bashrc" ]; then',
  '  . "$HOME/.bashrc"',
  'fi',
  '',
  '# Fix PATH: remove wrapper dir, re-prepend it',
  ...POSIX_PATH_REPREPEND,
  '',
  '# Emit OSC 133;D;<exit_code> after each command so the renderer can detect',
  "# the prior command's exit code without the PTY actually exiting. Skips the",
  '# very first prompt. Prepended to PROMPT_COMMAND so $? still reflects the',
  '# user command rather than a previously-installed hook.',
  '_ouijit_emit_exit_code() {',
  '  local code=$?',
  '  if [ -n "$_OUIJIT_HAS_RUN" ]; then',
  '    printf "\\033]133;D;%d\\007" "$code"',
  '  fi',
  '  _OUIJIT_HAS_RUN=1',
  '  return $code',
  '}',
  'if [ -n "$PROMPT_COMMAND" ]; then',
  '  PROMPT_COMMAND="_ouijit_emit_exit_code; $PROMPT_COMMAND"',
  'else',
  '  PROMPT_COMMAND="_ouijit_emit_exit_code"',
  'fi',
  '',
  '# When we exec into this shell from a one-off command (a hook script), the',
  '# subshell exit code is passed across the exec via OUIJIT_INITIAL_EXIT. Emit',
  '# OSC 133;D for it now so the renderer learns the result without waiting for',
  '# the user to type a command.',
  'if [ -n "${OUIJIT_INITIAL_EXIT-}" ]; then',
  '  printf "\\033]133;D;%d\\007" "$OUIJIT_INITIAL_EXIT"',
  '  unset OUIJIT_INITIAL_EXIT',
  'fi',
  '',
].join('\n');

const bashIntegration: ShellIntegration = {
  id: 'bash',
  matches: (shell) => shell.endsWith('/bash') || shell === 'bash',
  installFiles(dir) {
    fs.writeFileSync(path.join(dir, 'ouijit-bash-integration.bash'), BASH_INTEGRATION, { mode: 0o644 });
  },
  launch({ shell, integrationDir, command }) {
    // --rcfile/--init-file: bash sources this instead of ~/.bashrc; ours
    // sources .bashrc first, then fixes PATH.
    const rcfile = path.join(integrationDir, 'ouijit-bash-integration.bash');
    if (!command) return { file: shell, args: ['--init-file', rcfile] };
    return { file: shell, args: ['-ic', bootstrap(command, `exec bash --rcfile ${rcfile}`)] };
  },
};

// ── fish ─────────────────────────────────────────────────────────────

/** fish PATH fix + command-exit signal — written to shell-integration/ouijit-fish-integration.fish */
export const FISH_INTEGRATION = [
  '# Ouijit fish integration — keeps the wrapper dir first in PATH and emits',
  '# OSC 133;D after each command. Sourced via `fish -C`, which runs AFTER',
  "# config.fish, so this re-prepends the wrapper dir after the user's own PATH",
  '# edits (fish_add_path / fish_user_paths).',
  'if set -q OUIJIT_WRAPPER_DIR',
  '    set -l cleaned',
  '    for dir in $PATH',
  '        test "$dir" != "$OUIJIT_WRAPPER_DIR"; and set -a cleaned $dir',
  '    end',
  '    set -gx PATH $OUIJIT_WRAPPER_DIR $cleaned',
  'end',
  '',
  '# Emit OSC 133;D;<exit_code> after each command so the renderer can detect',
  "# the prior command's exit code without the PTY exiting. fish_postexec only",
  '# fires after a command actually runs, so (unlike zsh/bash) no first-prompt',
  '# guard is needed. Capture $status first — printf would otherwise clobber it.',
  'function _ouijit_emit_exit_code --on-event fish_postexec',
  '    set -l code $status',
  '    printf "\\033]133;D;%d\\007" $code',
  'end',
  '',
  '# When we exec into fish from a one-off command (a hook script), its exit',
  '# code arrives via OUIJIT_INITIAL_EXIT. Emit OSC 133;D for it now so the',
  '# renderer learns the result without waiting for the user to type a command.',
  'if set -q OUIJIT_INITIAL_EXIT',
  '    printf "\\033]133;D;%d\\007" $OUIJIT_INITIAL_EXIT',
  '    set -e OUIJIT_INITIAL_EXIT',
  'end',
  '',
].join('\n');

const fishIntegration: ShellIntegration = {
  id: 'fish',
  matches: (shell) => shell.endsWith('/fish') || shell === 'fish',
  installFiles(dir) {
    fs.writeFileSync(path.join(dir, 'ouijit-fish-integration.fish'), FISH_INTEGRATION, { mode: 0o644 });
  },
  launch({ shell, integrationDir, command }) {
    const initFile = path.join(integrationDir, 'ouijit-fish-integration.fish');
    // `-C` runs after config.fish but before the prompt — the right place to
    // re-fix PATH. Single-quote the path so spaces in $HOME survive fish's parse.
    const sourceArg = `source '${initFile}'`;
    if (!command) return { file: shell, args: ['-C', sourceArg] };
    // fish can't parse our POSIX bootstrap (export / (...) / $?), so /bin/sh
    // runs it and execs into fish with the integration sourced.
    return { file: '/bin/sh', args: ['-c', bootstrap(command, `exec ${shell} -C "${sourceArg}"`)] };
  },
};

// ── fallback ─────────────────────────────────────────────────────────

/**
 * Unknown shell: launch it, but with no integration. With a startup command the
 * POSIX bootstrap runs under /bin/sh and execs into the shell; without one the
 * shell launches directly. Fail open — exotic shells work, just without the
 * wrapper-PATH guarantee or exit-code signal until they get a provider.
 */
const posixFallbackIntegration: ShellIntegration = {
  id: 'posix',
  matches: () => true,
  installFiles() {},
  launch({ shell, command }) {
    if (!command) return { file: shell, args: [] };
    return { file: '/bin/sh', args: ['-c', bootstrap(command, `exec ${shell}`)] };
  },
};

// ── Registry ─────────────────────────────────────────────────────────

/** Providers with dedicated integration, tried in order. */
const SHELL_INTEGRATIONS: ShellIntegration[] = [zshIntegration, bashIntegration, fishIntegration];

/** The integration provider for a shell, or the fail-open fallback. */
export function resolveShellIntegration(shell: string): ShellIntegration {
  return SHELL_INTEGRATIONS.find((integration) => integration.matches(shell)) ?? posixFallbackIntegration;
}

/** Write every integrated shell's scripts into `integrationDir`. */
export function installShellIntegration(integrationDir: string): void {
  fs.mkdirSync(integrationDir, { recursive: true });
  for (const integration of SHELL_INTEGRATIONS) {
    integration.installFiles(integrationDir);
  }
}
