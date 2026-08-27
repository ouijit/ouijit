import type { ChangedFile, FileDiff, DiffHunk } from '../types';
import type { DiffSignals } from '../analysis/types';

/**
 * Everything an agent needs to group a diff, assembled here.
 *
 * The agent is asked one question with the answer material already in front of
 * it: it reads no files, calls no tools, and needs no approval for anything. A
 * headless session cannot approve a tool call, so anything it has to go and
 * fetch is somewhere the run can stall.
 *
 * A user writes only the instruction. Everything else on the way in, and the
 * shape expected on the way out, is ours to get right once.
 */

/** Characters of assembled prompt, kept well inside a single request. */
export const LENS_PROMPT_BUDGET = 120_000;

/** Above this a single hunk is summarised rather than quoted, so one enormous
 *  generated file cannot crowd out every other file in the change. */
const MAX_HUNK_CHARS = 6_000;

const MAX_BODY_CHARS = 4_000;

/**
 * A changed file, as much of one as the prompt needs.
 *
 * Structural rather than either concrete type, since a pull request's files
 * and a worktree's are the same list to a lens.
 */
export interface LensFile {
  path: string;
  status: ChangedFile['status'];
  additions: number;
  deletions: number;
  oldPath?: string;
}

/** What is being grouped, in the words the prompt opens with. */
export interface LensSubject {
  /** First line: what kind of thing this is. */
  lead: string;
  /** Markdown heading naming it — a PR number and title, or a branch. */
  heading: string;
  /** Whatever description exists: a PR body, or the task's prompt. */
  body?: string;
}

export interface LensPromptInput {
  subject: LensSubject;
  files: LensFile[];
  diffs: Map<string, FileDiff | null>;
  instruction: string;
  /** Hotspot and coupling signals, when the analysis flag is on. */
  signals?: DiffSignals | null;
  budget?: number;
}

/** The new-file lines a hunk covers, which is the vocabulary a lens answers in. */
export function hunkSpan(hunk: DiffHunk): [number, number] | null {
  let low: number | null = null;
  let high: number | null = null;
  for (const line of hunk.lines) {
    if (line.newLineNo == null) continue;
    if (low === null || line.newLineNo < low) low = line.newLineNo;
    if (high === null || line.newLineNo > high) high = line.newLineNo;
  }
  return low === null || high === null ? null : [low, high];
}

/** `@@ -12,7 +12,10 @@ export function readToken()` → `export function readToken()`. */
function hunkContext(header: string): string {
  return /^@@[^@]*@@\s*(.*)$/.exec(header)?.[1]?.trim() ?? '';
}

function hunkBody(hunk: DiffHunk): string {
  const lines = hunk.lines.map((line) => {
    const mark = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';
    return `${mark}${line.content}`;
  });
  const body = lines.join('\n');
  return body.length > MAX_HUNK_CHARS ? `${body.slice(0, MAX_HUNK_CHARS)}\n… hunk truncated` : body;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… truncated` : text;
}

/**
 * The skeleton of the change: every file, every hunk, and where each one sits.
 *
 * Sent whole, always. It is bounded by how many hunks a change has rather than
 * how large they are, and a grouping that has not been told a file exists can
 * only leave it out — which is the one thing a lens must never do.
 */
function skeleton(files: LensFile[], diffs: Map<string, FileDiff | null>): string {
  const out: string[] = [];

  for (const file of files) {
    const diff = diffs.get(file.path);
    const rename = file.oldPath ? ` (renamed from ${file.oldPath})` : '';
    out.push(`${file.path} — ${file.status}, +${file.additions} -${file.deletions}${rename}`);

    if (!diff) {
      out.push('  (diff unavailable)');
      continue;
    }
    if (diff.binary) {
      out.push('  (binary)');
      continue;
    }

    diff.hunks.forEach((hunk, index) => {
      const span = hunkSpan(hunk);
      const where = span ? `lines ${span[0]}-${span[1]}` : 'no lines in the new file';
      const context = hunkContext(hunk.header);
      out.push(`  [${index}] ${where}${context ? ` — ${context}` : ''}`);
    });
  }

  return out.join('\n');
}

/**
 * Hunk bodies, in file order, until the budget runs out.
 *
 * Truncating here rather than dropping files means the grouping degrades from
 * "read the code" to "read the shape" for the tail of a very large change,
 * instead of pretending the tail is not there.
 */
function bodies(
  files: LensFile[],
  diffs: Map<string, FileDiff | null>,
  budget: number,
): { text: string; omitted: number } {
  const out: string[] = [];
  let used = 0;
  let omitted = 0;

  for (const file of files) {
    const diff = diffs.get(file.path);
    if (!diff || diff.binary || diff.hunks.length === 0) continue;

    for (let index = 0; index < diff.hunks.length; index++) {
      const hunk = diff.hunks[index];
      const span = hunkSpan(hunk);
      const heading = `\n--- ${file.path} [${index}]${span ? ` lines ${span[0]}-${span[1]}` : ''} ---\n`;
      const body = hunkBody(hunk);

      if (used + heading.length + body.length > budget) {
        omitted++;
        continue;
      }
      out.push(heading + body);
      used += heading.length + body.length;
    }
  }

  return { text: out.join('\n'), omitted };
}

/** Above this a file is worth naming as one the change should be careful with. */
const HOTSPOT_SCORE = 0.6;

/**
 * What git history says about the files being changed, where it says anything.
 *
 * A grouping is a judgement about which parts of a change matter, and a file
 * that half the repo moves with is a different kind of thing to touch than one
 * nothing depends on. Only the files that stand out are listed: a score for
 * every path is a table nobody reads, and the ones left out are the ordinary
 * ones.
 *
 * Empty when the analysis flag is off, which is the usual case.
 */
function hotspots(files: LensFile[], signals: DiffSignals | null | undefined): string {
  if (!signals) return '';

  const lines: string[] = [];
  for (const file of files) {
    const analysis = signals[file.path];
    if (!analysis) continue;

    const notes: string[] = [];
    if (analysis.signal.score >= HOTSPOT_SCORE) {
      notes.push(`changed often and deeply nested (${analysis.signal.commits} commits)`);
    }
    if (analysis.signal.trend.direction === 'rising') notes.push('changing more lately than it used to');
    if (analysis.missing.length > 0) {
      notes.push(`usually changes with ${analysis.missing.map((p) => p.path).join(', ')}, absent here`);
    }
    if (notes.length > 0) lines.push(`${file.path} — ${notes.join('; ')}`);
  }

  if (lines.length === 0) return '';
  return ['# What the history says', '', ...lines].join('\n');
}

/**
 * What the schema cannot say.
 *
 * The CLI holds the reply to `LENS_SCHEMA`, so nothing here asks for JSON or
 * describes the fields' types. What is left is what the field names mean —
 * that `ranges` are new-file line numbers, and that binding is by whole hunk,
 * so an agent that is roughly right is exactly right.
 */
const OUTPUT_CONTRACT = `# The grouping

- "ranges" are new-file line numbers, matching the line spans listed above.
- A range that touches a hunk claims the whole hunk, so approximate ranges are fine.
- Use null for "ranges" to claim an entire file, and null for "summary" to leave it unsaid.
- Every group needs a title and at least one slice.
- Only use paths from the list above. Invented paths are dropped.
- You do not need to cover every file; whatever is left over is shown at the end.`;

/**
 * Characters the prompt for this change will run to, near enough.
 *
 * From the additions and deletions a status poll already returns, so asking
 * costs nothing and spawns no git. Answered in characters because that is what
 * `LENS_PROMPT_BUDGET` counts; whoever shows it can divide for tokens.
 */
export function estimateLensPromptChars(files: { additions: number; deletions: number }[]): number {
  // Per file: a heading and a hunk header or two. Per changed line: its text
  // and a marker. Both are averages, for a number shown with a tilde in front.
  return files.reduce((chars, file) => chars + 120 + (file.additions + file.deletions) * 40, 0);
}

export interface LensPrompt {
  prompt: string;
  /** Hunks listed but not quoted, because the change did not fit the budget. */
  omitted: number;
}

export function buildLensPrompt({ subject, files, diffs, instruction, signals, budget }: LensPromptInput): LensPrompt {
  const limit = budget ?? LENS_PROMPT_BUDGET;
  const structure = skeleton(files, diffs);
  const callouts = hotspots(files, signals);

  // The skeleton and the framing come first and are never trimmed; the bodies
  // take whatever is left.
  const remaining = Math.max(
    0,
    limit - structure.length - callouts.length - instruction.length - OUTPUT_CONTRACT.length - 2_000,
  );
  const { text: hunks, omitted } = bodies(files, diffs, remaining);

  const prompt = [
    subject.lead,
    '',
    subject.heading,
    '',
    subject.body ? truncate(subject.body, MAX_BODY_CHARS) : '(no description)',
    '',
    `# Files changed (${files.length})`,
    '',
    structure,
    '',
    ...(callouts ? [callouts, ''] : []),
    omitted > 0
      ? `# Code\n\nThe change is large, so ${omitted} hunk${omitted === 1 ? '' : 's'} below the budget are listed above but not quoted here. Group them from their line spans and enclosing declarations.`
      : '# Code',
    '',
    hunks,
    '',
    '# How to group it',
    '',
    instruction,
    '',
    OUTPUT_CONTRACT,
  ].join('\n');

  return { prompt, omitted };
}
