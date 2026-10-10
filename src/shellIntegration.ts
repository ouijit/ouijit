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
  /** Command the shell runs once at startup, or '' for none. */
  command: string;
  /** The user's current $ZDOTDIR, if any (zsh needs to restore it). */
  zdotdir?: string;
}

export interface ShellIntegration {
  /** Stable id for logging/tests. */
  id: string;
  /**
   * True if this provider keeps the wrapper dir first in PATH and emits OSC 133
   * exit codes. False is the fail-open fallback: the shell launches but the
   * bundled `claude`/`ouijit` wrappers and per-command status dots may not work.
   * Drives the one-time "limited shell support" notice.
   */
  isIntegrated: boolean;
  matches(shell: string): boolean;
  installFiles(integrationDir: string): void;
  launch(ctx: ShellLaunchContext): ShellLaunch;
}

// ── Startup command ──────────────────────────────────────────────────

const startupEnv = (command: string): Record<string, string> | undefined =>
  command ? { OUIJIT_STARTUP_COMMAND: command } : undefined;

// ── Shared script fragments ──────────────────────────────────────────

const indent = (lines: string[], pad: string): string[] => lines.map((line) => (line ? pad + line : line));

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

/**
 * bash/zsh prompt hook that runs the startup command once, as a job of the
 * interactive shell so Ctrl-Z then `fg` resumes it. It leaves the
 * environment first so a shell it starts does not run it again, and is cleared
 * before it runs, outside any `if`: zsh moves the rest of a compound command
 * stopped by Ctrl-Z into a subshell, where clearing it would not stick. The
 * subshell keeps a stray `exit` from closing the terminal; built inside the
 * `eval` so bash names the job after the command rather than this line.
 */
const posixStartupCommand = (beforeRun: string[] = []): string[] => [
  '_ouijit_startup_command=${OUIJIT_STARTUP_COMMAND-}',
  'unset OUIJIT_STARTUP_COMMAND',
  '_ouijit_run_startup_command() {',
  '  [ -n "$_ouijit_startup_command" ] || return',
  '  local cmd=$_ouijit_startup_command',
  '  _ouijit_startup_command=',
  ...indent(beforeRun, '  '),
  '  eval "( $cmd"$\'\\n\'")"',
  '  printf "\\033]133;D;%d\\007" "$?"',
  '}',
];

// ── zsh ──────────────────────────────────────────────────────────────

/** zsh ZDOTDIR bootstrap — written to shell-integration/zsh/.zshenv */
export const ZSH_ZSHENV = [
  '# Ouijit zsh integration — ZDOTDIR bootstrap (.zshenv stage).',
  '# Sources the user .zshenv, loads PATH fix, then keeps ZDOTDIR pointed at our',
  '# dir so zsh sources our .zshrc next (it sources the user .zshrc in turn).',
  '_OUIJIT_ZSH_HOME="$ZDOTDIR"',
  'ZDOTDIR="$OUIJIT_ZSH_ZDOTDIR"',
  '[ -z "$ZDOTDIR" ] && unset ZDOTDIR',
  '',
  '# Source user .zshenv (only if readable — a sandbox may deny it, and',
  '# sourcing a denied file errors loudly instead of being skipped).',
  'if [ -r "${ZDOTDIR:-$HOME}/.zshenv" ]; then',
  '  . "${ZDOTDIR:-$HOME}/.zshenv"',
  'fi',
  '',
  "# Remember where the user's .zshrc lives (their .zshenv may set ZDOTDIR).",
  '_OUIJIT_USER_ZDOTDIR="${ZDOTDIR:-$HOME}"',
  '',
  '# For interactive shells, load PATH fix',
  'if [[ -o interactive ]]; then',
  '  . "$OUIJIT_SHELL_INTEGRATION_DIR/ouijit-zsh-integration.zsh"',
  'fi',
  '',
  '# Back to our dir so zsh sources our .zshrc next.',
  'ZDOTDIR="$_OUIJIT_ZSH_HOME"',
  '',
].join('\n');

/** zsh rc stage — written to shell-integration/zsh/.zshrc, sourced after .zshenv */
export const ZSH_ZSHRC = [
  '# Ouijit zsh integration — .zshrc stage. We own this file so we can run after',
  "# the user's rc. Source the user .zshrc, then restore their ZDOTDIR.",
  'if [ -r "$_OUIJIT_USER_ZDOTDIR/.zshrc" ]; then',
  '  ZDOTDIR="$_OUIJIT_USER_ZDOTDIR"',
  '  . "$_OUIJIT_USER_ZDOTDIR/.zshrc"',
  'fi',
  'if [ -n "$OUIJIT_ZSH_ZDOTDIR" ]; then',
  '  ZDOTDIR="$OUIJIT_ZSH_ZDOTDIR"',
  'else',
  '  unset ZDOTDIR',
  'fi',
  'unset _OUIJIT_ZSH_HOME _OUIJIT_USER_ZDOTDIR',
  '',
  '# Registered after the user rc, which may reassign precmd_functions. The',
  "# exit-code hook goes first so $? is still the user command's.",
  'precmd_functions=(_ouijit_emit_exit_code $precmd_functions _ouijit_run_startup_command)',
  '',
  "# Under a filesystem sandbox the user's history file is denied. Point HISTFILE",
  '# at /dev/null AFTER the user rc (which may set it) so zsh never tries to lock',
  '# a file it cannot write — otherwise it prints "locking failed" at every',
  '# prompt. Gated so ordinary (non-sandboxed) terminals keep their history.',
  'if [ -n "$OUIJIT_SANDBOX_NO_HISTORY" ]; then',
  '  HISTFILE=/dev/null',
  '  SAVEHIST=0',
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
  '# very first prompt (no command has run yet). Registered from .zshrc.',
  '_ouijit_emit_exit_code() {',
  '  local code=$?',
  '  if [ -n "$_OUIJIT_HAS_RUN" ]; then',
  '    printf "\\033]133;D;%d\\007" "$code"',
  '  fi',
  '  _OUIJIT_HAS_RUN=1',
  '  return $code',
  '}',
  '',
  // zsh abandons the rest of a function, and the precmd hooks after it, when a
  // job it waits on dies of SIGINT, unless INT is trapped. The PATH fix is
  // repeated because a user rc that reassigns precmd_functions drops
  // _ouijit_fix_path.
  ...posixStartupCommand(['setopt localoptions localtraps', 'trap : INT', ...POSIX_PATH_REPREPEND]),
  '',
].join('\n');

const zshIntegration: ShellIntegration = {
  id: 'zsh',
  isIntegrated: true,
  matches: (shell) => shell.endsWith('/zsh') || shell === 'zsh',
  installFiles(dir) {
    const zshDir = path.join(dir, 'zsh');
    fs.mkdirSync(zshDir, { recursive: true });
    fs.writeFileSync(path.join(zshDir, '.zshenv'), ZSH_ZSHENV, { mode: 0o644 });
    fs.writeFileSync(path.join(zshDir, '.zshrc'), ZSH_ZSHRC, { mode: 0o644 });
    fs.writeFileSync(path.join(dir, 'ouijit-zsh-integration.zsh'), ZSH_INTEGRATION, { mode: 0o644 });
  },
  launch({ shell, integrationDir, command, zdotdir }) {
    // ZDOTDIR trick: zsh sources $ZDOTDIR/.zshenv first; ours restores the real
    // ZDOTDIR, sources the user's .zshenv, then registers the PATH-fix hooks.
    const env = {
      OUIJIT_ZSH_ZDOTDIR: zdotdir ?? '',
      ZDOTDIR: path.join(integrationDir, 'zsh'),
      ...startupEnv(command),
    };
    return { file: shell, args: [], env };
  },
};

// ── bash ─────────────────────────────────────────────────────────────

/** bash rcfile replacement — written to shell-integration/ouijit-bash-integration.bash */
export const BASH_INTEGRATION = [
  '# Ouijit bash integration — sources .bashrc then fixes PATH.',
  '# Only if readable — a sandbox may deny it, and sourcing a denied file',
  '# errors loudly instead of being skipped.',
  'if [ -r "$HOME/.bashrc" ]; then',
  '  . "$HOME/.bashrc"',
  'fi',
  '',
  "# Under a filesystem sandbox the user's history file is denied; point HISTFILE",
  '# at /dev/null (after .bashrc, which may set it) so history writes are not',
  '# attempted against a denied path. Gated so ordinary terminals keep history.',
  'if [ -n "$OUIJIT_SANDBOX_NO_HISTORY" ]; then',
  '  HISTFILE=/dev/null',
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
  '',
  ...posixStartupCommand(),
  // Newlines, not `;`: a PROMPT_COMMAND ending in `;` is common, and `; ;` is a
  // syntax error that would stop every hook in it.
  'PROMPT_COMMAND="_ouijit_emit_exit_code',
  '$PROMPT_COMMAND',
  '_ouijit_run_startup_command"',
  '',
].join('\n');

const bashIntegration: ShellIntegration = {
  id: 'bash',
  isIntegrated: true,
  matches: (shell) => shell.endsWith('/bash') || shell === 'bash',
  installFiles(dir) {
    fs.writeFileSync(path.join(dir, 'ouijit-bash-integration.bash'), BASH_INTEGRATION, { mode: 0o644 });
  },
  launch({ shell, integrationDir, command }) {
    // --init-file: bash sources this instead of ~/.bashrc; ours
    // sources .bashrc first, then fixes PATH.
    const rcfile = path.join(integrationDir, 'ouijit-bash-integration.bash');
    return { file: shell, args: ['--init-file', rcfile], env: startupEnv(command) };
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
  '# Run the startup command before the first prompt. fish gives a job the',
  '# terminal only under job control and outside an event handler, so it runs',
  '# here under full job control: Ctrl-Z then fg resumes it. It is POSIX sh, so',
  '# sh runs it. Erased before it runs so a fish it starts does not run it again.',
  'if set -q OUIJIT_STARTUP_COMMAND',
  '    set -l command $OUIJIT_STARTUP_COMMAND',
  '    set -e OUIJIT_STARTUP_COMMAND',
  '    set -l mode interactive',
  '    status is-full-job-control; and set mode full',
  '    status is-no-job-control; and set mode none',
  '    status job-control full',
  '    /bin/sh -c $command',
  '    set -l code $status',
  '    status job-control $mode',
  '    printf "\\033]133;D;%d\\007" $code',
  'end',
  '',
].join('\n');

const fishIntegration: ShellIntegration = {
  id: 'fish',
  isIntegrated: true,
  matches: (shell) => shell.endsWith('/fish') || shell === 'fish',
  installFiles(dir) {
    fs.writeFileSync(path.join(dir, 'ouijit-fish-integration.fish'), FISH_INTEGRATION, { mode: 0o644 });
  },
  launch({ shell, integrationDir, command }) {
    const initFile = path.join(integrationDir, 'ouijit-fish-integration.fish');
    // `-C` runs after config.fish but before the prompt — the right place to
    // re-fix PATH. Single-quote the path so spaces in $HOME survive fish's parse.
    const sourceArg = `source '${initFile}'`;
    return { file: shell, args: ['-C', sourceArg], env: startupEnv(command) };
  },
};

// ── fallback ─────────────────────────────────────────────────────────

/**
 * Unknown shell: launch it, but with no integration. With a startup command,
 * /bin/sh runs it and execs into the shell, so a command stopped with Ctrl-Z
 * cannot be resumed there. Fail open — exotic shells work, just without the
 * wrapper-PATH guarantee or exit-code signal until they get a provider.
 */
const posixFallbackIntegration: ShellIntegration = {
  id: 'posix',
  isIntegrated: false,
  matches: () => true,
  installFiles() {},
  launch({ shell, command }) {
    if (!command) return { file: shell, args: [] };
    return { file: '/bin/sh', args: ['-c', `export PATH="$OUIJIT_WRAPPER_DIR:$PATH"; (${command}); exec ${shell}`] };
  },
};

// ── Registry ─────────────────────────────────────────────────────────

/** Providers with dedicated integration, tried in order. */
const SHELL_INTEGRATIONS: ShellIntegration[] = [zshIntegration, bashIntegration, fishIntegration];

/** The integration provider for a shell, or the fail-open fallback. */
export function resolveShellIntegration(shell: string): ShellIntegration {
  return SHELL_INTEGRATIONS.find((integration) => integration.matches(shell)) ?? posixFallbackIntegration;
}

export function installShellIntegration(integrationDir: string): void {
  fs.mkdirSync(integrationDir, { recursive: true });
  for (const integration of SHELL_INTEGRATIONS) {
    integration.installFiles(integrationDir);
  }
}
