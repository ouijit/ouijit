import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getUserDataPath } from './paths';
import { shellJoin } from './utils/shellQuote';
import type { AskRun } from './types';

/** How much of a script the user is shown; the rest is summed up by its size. */
const MAX_SHOWN_FILE = 32_768;
/** Past this a script is not copied, so it can still change after it is read, and the ask says so. */
const MAX_COPIED_FILE = 10 * 1024 * 1024;
const SNAPSHOT_DAYS = 7;

function realLocation(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(realLocation(parent), path.basename(p));
  }
}

function within(root: string, file: string): boolean {
  const relative = path.relative(realLocation(root), realLocation(file));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The start of a file, as much as is shown, and whether it is text at all. */
function readStart(file: string): { size: number; head: string; binary: boolean } | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_SHOWN_FILE));
      fs.readSync(fd, buffer, 0, buffer.length, 0);
      const binary = buffer.includes(0);
      return { size: stat.size, head: binary ? '' : buffer.toString('utf8'), binary };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Copies the file somewhere a sandbox cannot write, so what runs is what the
 * user read: the agent can still edit the original after the card shows it.
 */
function snapshot(file: string): string {
  const root = path.join(getUserDataPath(), 'ask-runs');
  const cutoff = Date.now() - SNAPSHOT_DAYS * 86_400_000;
  for (const entry of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const dir = path.join(root, entry);
    if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
  }
  const dir = path.join(root, randomUUID());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const copy = path.join(dir, path.basename(file));
  fs.copyFileSync(file, copy);
  fs.chmodSync(copy, fs.statSync(file).mode & 0o777);
  return copy;
}

/**
 * The script a command runs, wherever in the command it is named, read so the
 * user sees what they approve: `cd x && ./fix.sh` or `bash /tmp/y.sh` would
 * otherwise show only a name over contents the agent wrote. Only files where a
 * sandboxed agent writes are shown: its worktree and the temp folders. Nothing
 * else is the agent's, and a host file named in a command is not the card's to
 * display.
 */
export function fileItRuns(command: string, cwd: string): Pick<AskRun, 'file' | 'runCommand'> {
  const roots = [cwd, os.tmpdir(), '/tmp'];
  const tokens = command.split(/(\s+)/);
  for (const token of tokens) {
    const word = token.replace(/^['"]|['"]$/g, '');
    if (!word.trim() || word.startsWith('-')) continue;
    const file = path.resolve(cwd, word);
    if (!roots.some((root) => within(root, file))) continue;
    const start = readStart(file);
    if (!start) continue;
    const shown = within(cwd, file) ? path.relative(realLocation(cwd), realLocation(file)) : file;
    const seen: NonNullable<AskRun['file']> = {
      path: shown,
      contents: start.head,
      size: start.size,
      ...(start.binary && { binary: true }),
      ...(!start.binary && start.size > MAX_SHOWN_FILE && { cut: true }),
    };
    if (start.size > MAX_COPIED_FILE) return { file: { ...seen, uncopied: true } };
    const copy = shellJoin([snapshot(file)]);
    return { file: seen, runCommand: tokens.map((t) => (t === token ? copy : t)).join('') };
  }
  return {};
}
