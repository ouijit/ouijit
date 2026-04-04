/**
 * Editor launching utilities.
 *
 * Uses launch-editor (by Evan You) for editor detection and file:line opening.
 * Handles Electron quirks: GUI apps don't inherit shell PATH, and editor CLIs
 * often live inside app bundles that were never added to PATH.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import launchEditor from 'launch-editor';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const guessEditor = require('launch-editor/guess') as (specifiedEditor?: string) => string[];
import { getHook } from './db';
import log from './log';

const editorLog = log.scope('editor');

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
 * known editor CLI binary directories. Called once, results cached.
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

export async function openInEditor(projectPath: string, dirPath: string): Promise<{ success: boolean }> {
  const hook = await getHook(projectPath, 'editor');
  if (!hook?.command) throw new Error('No editor configured');

  ensureEditorPath();
  spawn(hook.command, [dirPath], { detached: true, stdio: 'ignore', shell: true }).unref();
  return { success: true };
}

/**
 * Opens a file at a specific line in the user's editor.
 *
 * Always runs the editor hook first (ensures the editor is running), then
 * uses launch-editor to open the file at the correct line. If no hook is
 * configured, returns 'no-editor' so the renderer can show the setup dialog.
 */
export async function openFileInEditor(
  projectPath: string,
  workspaceRoot: string,
  filePath: string,
  line?: number,
  column?: number,
): Promise<{ success: boolean; error?: string }> {
  ensureEditorPath();

  const fullPath = path.resolve(workspaceRoot, filePath);

  // 1. Run the editor hook to ensure the editor is running
  const hook = await getHook(projectPath, 'editor');
  if (!hook?.command) return { success: false, error: 'no-editor' };

  spawn(hook.command, [fullPath], { detached: true, stdio: 'ignore', shell: true }).unref();

  // 2. Use launch-editor to open file at the correct line
  const [detectedEditor] = guessEditor();
  editorLog.info('opening file', { filePath, line, detectedEditor });
  const target = line ? `${fullPath}:${line}${column ? ':' + column : ''}` : fullPath;
  await tryLaunchEditor(target);

  return { success: true };
}

/**
 * Wraps launch-editor in a Promise. Returns null on success, error string on failure.
 * Suppresses launch-editor's console.log output by temporarily replacing it.
 */
function tryLaunchEditor(target: string): Promise<string | null> {
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
      launchEditor(target, undefined, (_fileName, msg) => {
        errorMsg = msg ?? 'No editor detected';
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
      setTimeout(() => resolve(null), 150);
    }
  });
}
