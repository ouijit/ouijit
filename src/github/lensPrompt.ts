import type { FileDiff, DiffHunk } from '../types';

/**
 * Everything an agent needs to group a pull request, assembled here.
 *
 * The point of the feature: the agent is asked one question, with the answer
 * material already in front of it. It reads no files, calls no tools, and needs
 * no approval for anything — which is what a lens used to fail on, since a
 * headless session cannot approve a tool call and would sit there until it gave
 * up and guessed.
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
 * Structural rather than either concrete type: a pull request's files and a
 * worktree's are the same list to a lens, and the only difference between them
 * is where they were read from.
 */
export interface LensFile {
  path: string;
  status: string;
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

/**
 * The output shape, stated as the thing it is: what `parseLens` will accept.
 *
 * Ranges are new-file line numbers because that is what the skeleton above
 * quotes, and because binding is by whole hunk — a range that touches a hunk
 * claims all of it, so an agent that is roughly right is exactly right.
 */
const OUTPUT_CONTRACT = `Reply with JSON and nothing else. No prose before or after, no code fence.

{
  "groups": [
    {
      "title": "short name for this part of the change",
      "summary": "one line on why these belong together",
      "slices": [
        { "path": "src/example.ts", "ranges": [[1, 40], [120, 129]] }
      ]
    }
  ]
}

Rules:
- "ranges" are new-file line numbers, matching the line spans listed above.
- A range that touches a hunk claims the whole hunk, so approximate ranges are fine.
- Omit "ranges" to claim an entire file.
- Every group needs a title and at least one slice.
- Only use paths from the list above. Invented paths are dropped.
- You do not need to cover every file; whatever is left over is shown at the end.`;

export function buildLensPrompt({ subject, files, diffs, instruction, budget }: LensPromptInput): string {
  const limit = budget ?? LENS_PROMPT_BUDGET;
  const structure = skeleton(files, diffs);

  // The skeleton and the framing come first and are never trimmed; the bodies
  // take whatever is left.
  const remaining = Math.max(0, limit - structure.length - instruction.length - OUTPUT_CONTRACT.length - 2_000);
  const { text: hunks, omitted } = bodies(files, diffs, remaining);

  return [
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
}

/**
 * The JSON in an agent's reply.
 *
 * Agents preface answers with banners, apologies and fenced blocks however
 * firmly they are asked not to, so the last balanced object in the output is
 * taken rather than the whole of it.
 */
export function extractJson(output: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  const fences = [...output.matchAll(fenced)].map((m) => m[1].trim());
  for (let i = fences.length - 1; i >= 0; i--) {
    if (fences[i].startsWith('{')) return fences[i];
  }

  const start = output.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < output.length; i++) {
    const char = output[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return output.slice(start, i + 1);
    }
  }

  return null;
}
