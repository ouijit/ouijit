import type { FileComplexitySignal } from './types';

const SPACES_PER_STEP = 4;

/**
 * Tornhill's language-neutral complexity proxy: how deeply the code nests,
 * read from leading whitespace alone. A tab counts as one step, four spaces
 * as one step.
 */
export function complexityOf(text: string): FileComplexitySignal {
  let loc = 0;
  let indentTotal = 0;
  let indentMax = 0;

  for (const line of text.split('\n')) {
    let spaces = 0;
    let i = 0;
    for (; i < line.length; i++) {
      const ch = line[i];
      if (ch === ' ') spaces++;
      else if (ch === '\t') spaces += SPACES_PER_STEP;
      else break;
    }
    if (i === line.length || line[i] === '\r') continue; // blank

    loc++;
    const depth = Math.floor(spaces / SPACES_PER_STEP);
    indentTotal += depth;
    if (depth > indentMax) indentMax = depth;
  }

  return { loc, indentTotal, indentMax };
}
