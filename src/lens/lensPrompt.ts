import type { ChangedFile, FileDiff, DiffHunk } from '../types';
import type { DiffSignals } from '../analysis/types';
import { hunkSpan } from './lens';

/**
 * Everything an agent needs to group a diff, assembled up front so it reads no
 * files and calls no tools: a headless session cannot approve a tool call, so
 * anything it has to go and fetch is somewhere the run can stall.
 */

/** Characters of assembled prompt, kept well inside a single request. */
export const LENS_PROMPT_BUDGET = 120_000;

/** Above this a hunk is truncated, so one generated file cannot crowd out the
 *  rest of the change. */
const MAX_HUNK_CHARS = 6_000;

const MAX_BODY_CHARS = 4_000;

/**
 * Structural rather than either concrete type, since a pull request's files and
 * a worktree's are the same list to a lens.
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
  /** What kind of thing this is. */
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
 * Every file, every hunk, and where each one sits. Sent whole, always: it is
 * bounded by how many hunks a change has rather than how large they are, and a
 * grouping never told a file exists can only leave it out.
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
 * Hunk bodies, in file order, until the budget runs out. Truncating here rather
 * than dropping files degrades the tail of a very large change from "read the
 * code" to "read the shape", instead of pretending it is not there.
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
 * Only the files that stand out: a score for every path is a table nobody
 * reads, and the ones left out are the ordinary ones.
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
 * A lens instruction says how to divide one change; everything true of every
 * grouping belongs here instead, so that a lens a user writes themselves still
 * gets it.
 */
const GROUPING_GUIDE = `# What makes a good grouping

You are grouping this for someone who reviews all day and cannot give every
file the same attention.

- Lead with the part the rest follows from — the decision, the contract, the
  schema. If they read one part, that is the one.
- One idea per part. A part a reviewer has to hold two things in mind for is
  two parts.
- Mechanical work goes last: renames, generated files, formatting, churn that
  follows from a decision made elsewhere.
- Three to six parts for an ordinary change. Fewer says nothing; more is a file
  list with headings on it. Go past six only when the change really is that big.
- A title names the part, it does not describe it — "The link mark", not "Link
  mark renders target/rel". What it does is the summary's job. It is shown in a
  narrow column, so keep it under about 35 characters.`;

/**
 * The CLI holds the reply to `LENS_SCHEMA`, so nothing here asks for JSON or
 * describes the fields' types. What is left is what the field names mean.
 */
const OUTPUT_CONTRACT = `# The grouping

- "ranges" are new-file line numbers, matching the line spans listed above.
- A range that touches a hunk claims the whole hunk, so approximate ranges are fine.
- Use null for "ranges" to claim an entire file, and null for "summary" to leave it unsaid.
- Every group needs a title and at least one slice.
- Only use paths from the list above. Invented paths are dropped.
- A file that belongs with nothing is better left out than gathered into a group
  of odds and ends. Whatever no group claims is shown at the end under its own
  heading.`;

/**
 * Near enough, from the additions and deletions a status poll already returns,
 * so asking costs nothing and spawns no git.
 */
export function estimateLensPromptChars(files: { additions: number; deletions: number }[]): number {
  // Averages, for a number shown with a tilde in front: a heading and a hunk
  // header or two per file, a marker and its text per changed line.
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

  // The skeleton and the framing are never trimmed; the bodies take what is
  // left, less slack for the headings joined around all of it.
  const remaining = Math.max(
    0,
    limit -
      structure.length -
      callouts.length -
      instruction.length -
      GROUPING_GUIDE.length -
      OUTPUT_CONTRACT.length -
      2_000,
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
    GROUPING_GUIDE,
    '',
    // Between the general guidance and the mechanics: theirs is the part that
    // decides how this change in particular divides.
    '# How to group it',
    '',
    instruction,
    '',
    OUTPUT_CONTRACT,
  ].join('\n');

  return { prompt, omitted };
}
