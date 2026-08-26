import { gitAsync } from '../git';
import { ANALYSIS_WINDOW_MONTHS, monthIndex } from './types';

interface LogFileChange {
  path: string;
  /** Set when this commit renamed the file — stats under oldPath move to path. */
  oldPath?: string;
  added: number;
  deleted: number;
}

export interface LogCommit {
  sha: string;
  /** Author time, unix seconds. */
  at: number;
  email: string;
  name: string;
  files: LogFileChange[];
}

const LOG_MAX_COMMITS = 5000;
/** A window's worth of numstat for a busy repo is single-digit MB; leave room. */
const LOG_MAX_BUFFER = 64 * 1024 * 1024;

/* Control characters as field framing: commit subjects can contain anything
   printable, so the format string avoids them entirely. */
const COMMIT_MARK = '\u0001';
const FIELD_SEP = '\u0002';
const LOG_FORMAT = '--format=%x01%H%x02%at%x02%aE%x02%aN';

/**
 * One pass over history for a range (`sha`, or `last..sha` for an
 * incremental fold), oldest first. Merges are skipped: their numstat repeats
 * the work of the commits they merge.
 *
 * Only commits inside the plotted window come back: `--since` cuts on
 * committer date, mid-month, so the log reaches past the calendar months a
 * monthly series covers, and a rebase can carry an author date outside them
 * either way. A commit that counts has to be a commit that plots.
 */
export async function readLog(projectPath: string, range: string): Promise<LogCommit[]> {
  const output = await gitAsync(
    [
      'log',
      range,
      '--no-merges',
      '--numstat',
      // Explicit, so a user's diff.renames=false can't split every rename
      // into a delete and an add.
      '--find-renames',
      `--since=${ANALYSIS_WINDOW_MONTHS} months ago`,
      `--max-count=${LOG_MAX_COMMITS}`,
      LOG_FORMAT,
    ],
    projectPath,
    LOG_MAX_BUFFER,
  );

  const newest = monthIndex(Date.now() / 1000);
  const oldest = newest - (ANALYSIS_WINDOW_MONTHS - 1);
  return parseLog(output)
    .reverse()
    .filter((commit) => {
      const month = monthIndex(commit.at);
      return month >= oldest && month <= newest;
    });
}

/** Newest first, as git prints it. */
export function parseLog(output: string): LogCommit[] {
  const commits: LogCommit[] = [];
  for (const record of output.split(COMMIT_MARK)) {
    if (!record.trim()) continue;
    const lines = record.split('\n');
    const [sha, at, email, name] = lines[0].split(FIELD_SEP);
    if (!sha) continue;

    const files: LogFileChange[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length < 3) continue;
      // Binary files report `-` for both counts: counted, zero churn.
      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      files.push({ ...parseRenamePath(parts.slice(2).join('\t')), added, deleted });
    }

    commits.push({
      sha,
      at: parseInt(at, 10) || 0,
      email: detach(email ?? ''),
      name: detach(name ?? ''),
      files,
    });
  }
  return commits;
}

/**
 * V8 keeps a substring as a view onto the string it came from. Paths and
 * author identities become the model's long-lived keys, so left as views they
 * would pin the whole multi-megabyte log output for the life of the process;
 * concatenating forces a copy of just the value.
 */
function detach(text: string): string {
  return (' ' + text).slice(1);
}

/**
 * Resolves numstat's rename notations — `old.ts => new.ts` for a whole path,
 * `src/{a => b}/f.ts` for a shared prefix/suffix (either side may be empty,
 * leaving a doubled slash to collapse).
 */
export function parseRenamePath(raw: string): { path: string; oldPath?: string } {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braced) {
    const [, pre, oldMid, newMid, post] = braced;
    return { path: detach(collapse(pre + newMid + post)), oldPath: detach(collapse(pre + oldMid + post)) };
  }
  const arrow = raw.indexOf(' => ');
  if (arrow !== -1) return { path: detach(raw.slice(arrow + 4)), oldPath: detach(raw.slice(0, arrow)) };
  return { path: detach(raw) };
}

function collapse(path: string): string {
  return path.replace('//', '/');
}
