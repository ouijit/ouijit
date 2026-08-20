import { createHighlighter, bundledLanguages } from 'shiki';
import type { BundledLanguage } from 'shiki';
import type { ThemedToken, HighlighterGeneric } from '@shikijs/types';
import type { DiffHunk } from '../git';
import { SHIKI_THEMES, currentShikiTheme } from '../theme/shikiTheme';

export type { ThemedToken };

export type HunkTokens = (ThemedToken[] | null)[];

const PRELOADED_LANGS: BundledLanguage[] = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'css',
  'html',
  'markdown',
  'python',
  'rust',
  'go',
  'yaml',
  'toml',
  'bash',
  'sql',
  'ruby',
  'swift',
  'c',
  'cpp',
  'java',
  'diff',
];

// Extension → shiki language ID
const EXT_MAP: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  jsonc: 'jsonc',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown',
  mdx: 'mdx',
  py: 'python',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  sql: 'sql',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  java: 'java',
  kt: 'kotlin',
  scala: 'scala',
  php: 'php',
  lua: 'lua',
  r: 'r',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  ml: 'ocaml',
  tf: 'terraform',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  xml: 'xml',
  svg: 'xml',
};

/**
 * Tokens already computed for a hunk, keyed by the hunk object itself.
 *
 * A hunk object is stable for as long as its file's diff is, and slicing a diff
 * reuses the very same hunk objects, so one hunk can be handed out under more
 * than one reference. Keying on identity means each is tokenized once however
 * many places render it, and a weak key means the entry goes when the diff does.
 */
const HUNK_TOKENS = new WeakMap<DiffHunk, Map<string, HunkTokens>>();

/**
 * Past these, highlighting costs more than it returns — a generated bundle or a
 * lockfile is not read for its syntax, and tokenizing one stalls the diff that
 * is being read.
 */
const MAX_HIGHLIGHT_LINES = 4000;
const MAX_LINE_LENGTH = 1000;
const MAX_HUNK_CHARS = 200_000;

/** Longest the tokenizer may hold the main thread before letting go. */
const SLICE_MS = 8;

let highlighterPromise: Promise<HighlighterGeneric<any, any>> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_THEMES.dark, SHIKI_THEMES.light],
      langs: PRELOADED_LANGS,
    });
  }
  return highlighterPromise;
}

function detectLanguage(filePath: string): BundledLanguage | null {
  const fileName = filePath.split('/').pop() ?? '';
  const lowerName = fileName.toLowerCase();

  // Handle dotfiles and special filenames
  if (lowerName === 'dockerfile' || lowerName.startsWith('dockerfile.')) return 'dockerfile';
  if (lowerName === 'makefile' || lowerName === 'gnumakefile') return 'make';

  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : null;
  if (!ext) return null;

  const mapped = EXT_MAP[ext];
  if (mapped) return mapped;

  // Try the extension directly as a language name (shiki supports many)
  if (ext in bundledLanguages) return ext as BundledLanguage;

  return null;
}

function blankTokens(hunks: DiffHunk[]): HunkTokens[] {
  return hunks.map((hunk): HunkTokens => hunk.lines.map((): ThemedToken[] | null => null));
}

/** A file big enough that tokenizing it would cost more than the colour is worth. */
function tooLargeToHighlight(hunks: DiffHunk[]): boolean {
  let lines = 0;
  for (const hunk of hunks) {
    lines += hunk.lines.length;
    if (lines > MAX_HIGHLIGHT_LINES) return true;
  }
  return false;
}

/** What varies the tokens for a given hunk: the theme they are coloured for. */
function cacheKey(lang: string): string {
  return `${currentShikiTheme()}\u0000${lang}`;
}

function readCache(hunks: DiffHunk[], key: string): HunkTokens[] | null {
  const found: HunkTokens[] = [];
  for (const hunk of hunks) {
    const cached = HUNK_TOKENS.get(hunk)?.get(key);
    if (!cached) return null;
    found.push(cached);
  }
  return found;
}

function writeCache(hunk: DiffHunk, key: string, tokens: HunkTokens): void {
  let byKey = HUNK_TOKENS.get(hunk);
  if (!byKey) {
    byKey = new Map();
    HUNK_TOKENS.set(hunk, byKey);
  }
  byKey.set(key, tokens);
}

/**
 * Tokens for a diff if they can be had without doing any work.
 *
 * Rendering starts from this, so a file that has been tokenized before draws
 * highlighted on its first frame rather than flashing plain and re-colouring.
 */
export function peekDiffTokens(hunks: DiffHunk[], filePath: string): HunkTokens[] | null {
  if (hunks.length === 0) return null;
  const lang = detectLanguage(filePath);
  if (!lang || tooLargeToHighlight(hunks)) return blankTokens(hunks);
  return readCache(hunks, cacheKey(lang));
}

/**
 * Tokenizing runs one file at a time.
 *
 * Every visible file section asks at once, and each answer is synchronous CPU
 * once the highlighter is up. Left unqueued they land as one unbroken block of
 * work with no frame in between, which is precisely when a scroll stutters.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  // The chain must survive a rejection, or one failed file stops every file
  // queued behind it.
  const settled = (): void => undefined;
  queue = result.then(settled, settled);
  return result;
}

/** Hand the main thread back if this pass has been holding it too long. */
async function breathe(since: number): Promise<number> {
  if (performance.now() - since < SLICE_MS) return since;
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return performance.now();
}

/**
 * Tokenize all hunks in a diff for syntax highlighting.
 *
 * For each hunk, reconstructs "old" (context + deletions) and "new" (context + additions)
 * pseudo-documents, tokenizes each, then maps tokens back to original line positions.
 */
export async function tokenizeDiffHunks(hunks: DiffHunk[], filePath: string): Promise<HunkTokens[]> {
  const lang = detectLanguage(filePath);
  // Unknown language, or too much of it — plain text fallback.
  if (!lang || tooLargeToHighlight(hunks)) return blankTokens(hunks);

  const key = cacheKey(lang);
  const cached = readCache(hunks, key);
  if (cached) return cached;

  const hl = await getHighlighter();

  // Ensure language is loaded (may not be in preloaded set)
  const loadedLangs = hl.getLoadedLanguages();
  if (!loadedLangs.includes(lang)) {
    try {
      await hl.loadLanguage(lang);
    } catch {
      // Language not available — fall back to plain text
      return blankTokens(hunks);
    }
  }

  return enqueue(async () => {
    let since = performance.now();
    const result: HunkTokens[] = [];
    for (const hunk of hunks) {
      const known = HUNK_TOKENS.get(hunk)?.get(key);
      if (known) {
        result.push(known);
        continue;
      }
      const tokens = tokenizeHunk(hl, hunk, lang);
      writeCache(hunk, key, tokens);
      result.push(tokens);
      since = await breathe(since);
    }
    return result;
  });
}

function tokenizeHunk(hl: HighlighterGeneric<any, any>, hunk: DiffHunk, lang: string): HunkTokens {
  const { lines } = hunk;

  // One minified line can hold more text than a whole file of source, and
  // tokenizing it produces thousands of spans.
  let chars = 0;
  for (const line of lines) {
    chars += line.content.length;
    if (line.content.length > MAX_LINE_LENGTH || chars > MAX_HUNK_CHARS) {
      return lines.map((): ThemedToken[] | null => null);
    }
  }

  // Build "old" and "new" line lists with indices back to original lines
  const oldLines: { idx: number; text: string }[] = [];
  const newLines: { idx: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type === 'context') {
      oldLines.push({ idx: i, text: line.content });
      newLines.push({ idx: i, text: line.content });
    } else if (line.type === 'deletion') {
      oldLines.push({ idx: i, text: line.content });
    } else {
      newLines.push({ idx: i, text: line.content });
    }
  }

  // Tokenize both reconstructed documents
  const oldTokens = tokenizeLines(
    hl,
    oldLines.map((l) => l.text),
    lang,
  );
  const newTokens = tokenizeLines(
    hl,
    newLines.map((l) => l.text),
    lang,
  );

  // Map back to original line indices
  const result: HunkTokens = new Array(lines.length).fill(null);

  // Context lines appear in both — use "new" tokens (identical content, but "new" has better
  // grammar state for additions that follow)
  const contextFromNew = new Map<number, ThemedToken[]>();
  for (let i = 0; i < newLines.length; i++) {
    if (lines[newLines[i].idx].type === 'context') {
      contextFromNew.set(newLines[i].idx, newTokens[i]);
    }
  }

  for (let i = 0; i < oldLines.length; i++) {
    const lineIdx = oldLines[i].idx;
    if (lines[lineIdx].type === 'deletion') {
      result[lineIdx] = oldTokens[i];
    }
  }

  for (let i = 0; i < newLines.length; i++) {
    const lineIdx = newLines[i].idx;
    if (lines[lineIdx].type === 'addition') {
      result[lineIdx] = newTokens[i];
    } else if (lines[lineIdx].type === 'context') {
      result[lineIdx] = newTokens[i];
    }
  }

  // Fill any remaining context lines from old tokens if somehow missed
  for (let i = 0; i < oldLines.length; i++) {
    const lineIdx = oldLines[i].idx;
    if (result[lineIdx] === null && lines[lineIdx].type === 'context') {
      result[lineIdx] = oldTokens[i];
    }
  }

  return result;
}

function tokenizeLines(hl: HighlighterGeneric<any, any>, lines: string[], lang: string): ThemedToken[][] {
  if (lines.length === 0) return [];

  const code = lines.join('\n');
  const { tokens } = hl.codeToTokens(code, { lang, theme: currentShikiTheme() });
  return tokens.map(coalesce);
}

/**
 * Merge neighbouring tokens that are styled the same.
 *
 * Shiki splits on grammar, so `foo.bar.baz` can arrive as five tokens all one
 * colour — five DOM nodes per line where one would look identical. Across a
 * large diff this is the difference between tens of thousands of spans and a
 * fraction of that.
 */
function coalesce(tokens: ThemedToken[]): ThemedToken[] {
  if (tokens.length < 2) return tokens;

  const merged: ThemedToken[] = [];
  let current: ThemedToken | null = null;

  for (const token of tokens) {
    if (
      current &&
      current.color === token.color &&
      current.fontStyle === token.fontStyle &&
      current.bgColor === token.bgColor
    ) {
      // `current` is our own copy, never shiki's — safe to append in place.
      current.content += token.content;
      continue;
    }
    current = { ...token };
    merged.push(current);
  }

  return merged;
}
