import * as path from 'node:path';
import type { SandboxLaunch } from '../types';
import { isPathInside } from '../../utils/pathSafety';

export const NO_COMMAND_MESSAGE =
  'No sandbox command configured. Set one in Project Settings ▸ Sandbox ▸ Custom, or run `ouijit sandbox-command set <command>`.';

/**
 * Split a launcher command into argv the way a POSIX shell would read the
 * words, and nothing more: single quotes are literal, double quotes honour
 * backslash escapes, a bare backslash escapes the next character. There is no
 * variable, glob, or `~` expansion — the string is host-owned configuration and
 * runs exactly as written.
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inWord = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null;
      } else if (ch === '\\' && i + 1 < command.length && '"\\$`\n'.includes(command[i + 1])) {
        current += command[++i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === '\\') {
      if (i + 1 >= command.length) throw new Error('Sandbox command ends with a dangling backslash');
      current += command[++i];
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) {
        tokens.push(current);
        current = '';
        inWord = false;
      }
    } else {
      current += ch;
      inWord = true;
    }
  }
  if (quote) throw new Error(`Sandbox command has an unterminated ${quote === "'" ? 'single' : 'double'} quote`);
  if (inWord) tokens.push(current);
  return tokens;
}

/**
 * Tokenize and vet a launcher command. The launcher runs on the host before any
 * boundary exists, so it must not be a path the sandboxed agent could have
 * written: one relative to the spawn cwd, or one under `forbiddenRoots`. A bare
 * name resolves through PATH on the host.
 */
export function resolveCommandTokens(command: string, forbiddenRoots: string[] = []): string[] {
  const tokens = tokenizeCommand(command);
  const [file] = tokens;
  if (!file) throw new Error(NO_COMMAND_MESSAGE);
  if (file.includes('/') && !path.isAbsolute(file)) {
    throw new Error(
      `Sandbox command "${file}" is a relative path; it would resolve inside the task worktree, which the sandboxed agent can edit. Use an absolute path or a name on PATH.`,
    );
  }
  for (const root of forbiddenRoots) {
    if (path.isAbsolute(file) && isPathInside(file, root)) {
      throw new Error(
        `Sandbox command "${file}" lives inside ${root}, which the sandboxed agent can edit. Install the launcher outside the worktree.`,
      );
    }
  }
  return tokens;
}

/**
 * Wrap a host launch in the project's launcher, which is invoked as
 * `<launcher> [args] -- <shell> [shell args]`.
 */
export function buildCustomLaunch(
  command: string,
  launch: SandboxLaunch,
  forbiddenRoots: string[] = [],
): SandboxLaunch {
  const tokens = resolveCommandTokens(command, forbiddenRoots);
  return {
    file: tokens[0],
    args: [...tokens.slice(1), '--', launch.file, ...launch.args],
    env: launch.env,
  };
}
