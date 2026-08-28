/**
 * Editor launching utilities.
 *
 * Uses launch-editor (by Evan You) for editor detection and file:line opening.
 * Handles Electron quirks: GUI apps don't inherit shell PATH, and editor CLIs
 * often live inside app bundles that were never added to PATH.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import launchEditor from 'launch-editor';
import { getHook } from './db';
import type { EditorOpenResult } from './types';
import { getLogger } from './logger';

const editorLog = getLogger().scope('editor');

// ── PATH resolution ─────────────────────────────────────────────────

/** Known macOS app bundles that embed CLI binaries. */
const MACOS_EDITOR_BIN_DIRS = [
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin',
  '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin',
  '/Applications/VSCodium.app/Contents/Resources/app/bin',
  '/Applications/Cursor.app/Contents/Resources/app/bin',
  '/Applications/Zed.app/Contents/MacOS',
];

let pathResolved = false;

/**
 * Ensures process.env.PATH includes the user's login shell PATH and
 * known editor CLI binary directories. Cached after the first call.
 */
function ensureEditorPath(): void {
  if (pathResolved) return;
  pathResolved = true;

  const parts: string[] = [];

  // 1. Resolve the user's login shell PATH
  try {
    const sh = process.env.SHELL || '/bin/sh';
    const resolved = execFileSync(sh, ['-l', '-c', 'printenv PATH'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    if (resolved) parts.push(resolved);
  } catch {
    /* keep existing PATH */
  }

  // 2. Prepend known editor bin dirs that exist on disk
  if (process.platform === 'darwin') {
    for (const dir of MACOS_EDITOR_BIN_DIRS) {
      try {
        if (fs.statSync(dir).isDirectory()) parts.unshift(dir);
      } catch {
        /* dir doesn't exist */
      }
    }
  }

  if (parts.length > 0) {
    const existing = process.env.PATH || '';
    process.env.PATH = [...parts, existing].join(path.delimiter);
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Opens a file at a specific line in the user's editor.
 *
 * The registered command is handed to launch-editor as the editor to use.
 * Letting it detect one instead would open the file in whatever editor happens
 * to be running, which is not the one the user registered. Every way this can
 * fail is named in the result.
 */
export async function openFileInEditor(
  projectPath: string,
  workspaceRoot: string,
  filePath: string,
  line?: number,
): Promise<EditorOpenResult> {
  ensureEditorPath();

  const fullPath = path.resolve(workspaceRoot, filePath);

  const hook = await getHook(projectPath, 'editor');
  if (!hook?.command) return { success: false, reason: 'no-editor' };

  // launch-editor returns without calling back when the file is gone, so the
  // check has to happen here or the failure has no way to surface.
  if (!fs.existsSync(fullPath)) return { success: false, reason: 'missing-file' };

  const editor = path.basename(hook.command.split(' ')[0]);
  const target = line ? `${fullPath}:${line}` : fullPath;
  editorLog.info('opening file', { filePath, line, editor });

  const failure = await tryLaunchEditor(target, hook.command);
  if (failure) {
    editorLog.warn('editor launch failed', { target, editor, failure });
    return { success: false, reason: 'launch-failed', editor };
  }
  return { success: true };
}

/**
 * Runs `editor` against `target`, resolving null on success and the failure on
 * anything else. Suppresses launch-editor's console.log output by temporarily
 * replacing it.
 */
function tryLaunchEditor(target: string, editor: string): Promise<string | null> {
  return new Promise((resolve) => {
    let errorMsg: string | null = null;

    // Suppress launch-editor's console.log calls (it logs red error text)
    const origLog = console.log;
    console.log = () => {};

    // Patch spawn so launch-editor never uses stdio: 'inherit' (which hijacks the parent TTY).
    // launch-editor uses require('child_process'), so patch that CJS module object.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cp = require('node:child_process');
    const origSpawn = cp.spawn;
    cp.spawn = (cmd: string, args: string[], opts: { stdio?: unknown }) =>
      origSpawn(cmd, args, { ...opts, stdio: 'ignore' });

    try {
      launchEditor(target, editor, (_fileName, msg) => {
        errorMsg = msg ?? 'no editor detected';
      });
    } finally {
      console.log = origLog;
      cp.spawn = origSpawn;
    }

    // launch-editor calls the error callback synchronously when no editor is found,
    // but spawn errors (ENOENT) are async. Wait briefly for those.
    if (errorMsg) {
      resolve(errorMsg);
    } else {
      setTimeout(() => resolve(errorMsg), 150);
    }
  });
}
