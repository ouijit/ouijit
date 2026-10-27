import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getUserDataPath } from './paths';
import { shellJoin } from './utils/shellQuote';
import type { AskRun } from './types';

const MAX_SHOWN_FILE = 32_768;
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

function readText(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_SHOWN_FILE) return null;
    const contents = fs.readFileSync(file, 'utf8');
    return contents.includes('\0') ? null : contents;
  } catch {
    return null;
  }
}

/**
 * Copies the file somewhere a sandbox cannot write, so what runs is what the
 * user read: the agent can still edit the original after the card shows it.
 */
function snapshot(file: string, contents: string): string {
  const root = path.join(getUserDataPath(), 'ask-runs');
  const cutoff = Date.now() - SNAPSHOT_DAYS * 86_400_000;
  for (const entry of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const dir = path.join(root, entry);
    if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
  }
  const dir = path.join(root, randomUUID());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const copy = path.join(dir, path.basename(file));
  fs.writeFileSync(copy, contents, { mode: fs.statSync(file).mode & 0o777 });
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
    const contents = readText(file);
    if (contents === null) continue;
    const shown = within(cwd, file) ? path.relative(realLocation(cwd), realLocation(file)) : file;
    const copy = shellJoin([snapshot(file, contents)]);
    return {
      file: { path: shown, contents },
      runCommand: tokens.map((t) => (t === token ? copy : t)).join(''),
    };
  }
  return {};
}
