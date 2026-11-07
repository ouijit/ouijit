/**
 * `ouijit://` links: a place in Ouijit, written so a person can read where it
 * goes. The CLI builds them for an agent to put in its reply; the app opens
 * them. Opening one only navigates — a link is text any program can print, so
 * nothing it names may run, approve or change anything.
 */

/** A file in a diff, and optionally one line of it, by its path in the worktree. */
export interface DiffSpot {
  path: string;
  line?: number;
}

export type LinkTarget =
  | { kind: 'project'; project: string }
  | { kind: 'board'; project: string }
  | { kind: 'task'; project: string; taskNumber: number; diff?: DiffSpot }
  | { kind: 'terminal'; project: string; ptyId: string; diff?: DiffSpot; panelId?: string }
  | { kind: 'pr'; project: string; number: number }
  | { kind: 'issue'; project: string; id: string };

/** A link in running text: ends before trailing punctuation, so a link at the end of a sentence keeps its period out. */
export const LINK_PATTERN = /ouijit:\/\/[^\s"'<>`]*[^\s"'<>`.,;:!?)\]}]/;

const segment = encodeURIComponent;

function diffPart({ path, line }: DiffSpot): string {
  return `/diff/${path.split('/').map(segment).join('/')}${line != null ? `:${line}` : ''}`;
}

export function buildLink(target: LinkTarget): string {
  const base = `ouijit://${segment(target.project)}`;
  switch (target.kind) {
    case 'project':
      return base;
    case 'board':
      return `${base}/board`;
    case 'task':
      return `${base}/tasks/${target.taskNumber}${target.diff ? diffPart(target.diff) : ''}`;
    case 'terminal': {
      const rest = target.diff ? diffPart(target.diff) : target.panelId ? `/panels/${segment(target.panelId)}` : '';
      return `${base}/terminals/${segment(target.ptyId)}${rest}`;
    }
    case 'pr':
      return `${base}/pulls/${target.number}`;
    case 'issue':
      return `${base}/issues/${segment(target.id)}`;
  }
}

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

function parseDiff(parts: string[]): DiffSpot | null {
  const decoded = parts.map(decode);
  if (decoded.length === 0 || decoded.some((p) => p === null)) return null;
  const match = /^(.+?)(?::(\d+))?$/.exec(decoded.join('/'));
  if (!match) return null;
  return { path: match[1], ...(match[2] && { line: Number(match[2]) }) };
}

/** The target a link names, or null for anything that is not a well-formed Ouijit link. */
export function parseLink(uri: string): LinkTarget | null {
  const match = /^ouijit:\/\/([^/?#]+)\/?([^?#]*)$/.exec(uri.trim());
  if (!match) return null;
  const project = decode(match[1]);
  if (!project) return null;
  const [section, id, sub, ...rest] = match[2].split('/').filter(Boolean);

  if (!section) return { kind: 'project', project };
  if (section === 'board' && !id) return { kind: 'board', project };
  if (section === 'pulls' && /^\d+$/.test(id ?? '') && !sub) return { kind: 'pr', project, number: Number(id) };
  if (section === 'issues' && id && !sub) {
    const issue = decode(id);
    return issue ? { kind: 'issue', project, id: issue } : null;
  }
  if (section === 'tasks' && /^\d+$/.test(id ?? '')) {
    const task = { kind: 'task' as const, project, taskNumber: Number(id) };
    if (!sub) return task;
    const diff = sub === 'diff' ? parseDiff(rest) : null;
    return diff ? { ...task, diff } : null;
  }
  if (section === 'terminals' && id) {
    const ptyId = decode(id);
    if (!ptyId) return null;
    const terminal = { kind: 'terminal' as const, project, ptyId };
    if (!sub) return terminal;
    if (sub === 'diff') {
      const diff = parseDiff(rest);
      return diff ? { ...terminal, diff } : null;
    }
    if (sub === 'panels' && rest.length === 1) {
      const panelId = decode(rest[0]);
      return panelId ? { ...terminal, panelId } : null;
    }
  }
  return null;
}
