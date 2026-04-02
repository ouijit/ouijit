import { createHighlighter, bundledLanguages } from 'shiki';
import type { BundledLanguage } from 'shiki';
import type { ThemedToken, HighlighterGeneric } from '@shikijs/types';
import type { DiffHunk } from '../git';

export type { ThemedToken };

/** Tokens for each line in a hunk, indexed by line position within the hunk */
export type HunkTokens = (ThemedToken[] | null)[];

const THEME = 'github-dark';

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

let highlighterPromise: Promise<HighlighterGeneric<any, any>> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
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

/**
 * Tokenize all hunks in a diff for syntax highlighting.
 *
 * For each hunk, reconstructs "old" (context + deletions) and "new" (context + additions)
 * pseudo-documents, tokenizes each, then maps tokens back to original line positions.
 */
export async function tokenizeDiffHunks(hunks: DiffHunk[], filePath: string): Promise<HunkTokens[]> {
  const lang = detectLanguage(filePath);
  if (!lang) {
    // Unknown language — return null tokens (plain text fallback)
    return hunks.map((hunk): HunkTokens => hunk.lines.map((): ThemedToken[] | null => null));
  }

  const hl = await getHighlighter();

  // Ensure language is loaded (may not be in preloaded set)
  const loadedLangs = hl.getLoadedLanguages();
  if (!loadedLangs.includes(lang)) {
    try {
      await hl.loadLanguage(lang);
    } catch {
      // Language not available — fall back to plain text
      return hunks.map((hunk): HunkTokens => hunk.lines.map((): ThemedToken[] | null => null));
    }
  }

  return hunks.map((hunk) => tokenizeHunk(hl, hunk, lang));
}

function tokenizeHunk(hl: HighlighterGeneric<any, any>, hunk: DiffHunk, lang: string): HunkTokens {
  const { lines } = hunk;

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
  const { tokens } = hl.codeToTokens(code, { lang, theme: THEME });
  return tokens;
}
