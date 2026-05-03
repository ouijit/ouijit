import { marked, type Token, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { createHighlighter } from 'shiki';
import type { BundledLanguage, HighlighterGeneric, BundledTheme } from 'shiki';
import mermaid from 'mermaid';
import log from 'electron-log/renderer';
import { linkifyFilePaths } from './linkifyFilePaths';

const planRenderLog = log.scope('planRender');

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

let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [THEME], langs: PRELOADED_LANGS }).catch((err) => {
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

let mermaidInitialized = false;
let mermaidCounter = 0;

function ensureMermaid(): void {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  mermaidInitialized = true;
}

async function renderMermaidBlock(source: string): Promise<string | null> {
  ensureMermaid();
  const id = `mermaid-${Date.now()}-${++mermaidCounter}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch (err) {
    planRenderLog.warn('mermaid render failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    // mermaid.render leaves a transient element in the DOM under #d<id>; clean it up
    document.getElementById(id)?.remove();
    document.querySelector(`#d${id}`)?.remove();
  }
}

function isCodeToken(token: Token): token is Tokens.Code {
  return token.type === 'code';
}

async function preRenderMermaid(tokens: Token[], svgs: Map<string, string>): Promise<void> {
  for (const token of tokens) {
    if (isCodeToken(token) && token.lang === 'mermaid') {
      const placeholder = `__OUIJIT_MERMAID_${svgs.size}__`;
      const svg = await renderMermaidBlock(token.text);
      if (svg) {
        svgs.set(placeholder, svg);
        token.text = placeholder;
        token.lang = 'mermaid-rendered';
      }
      continue;
    }
    const nested = (token as { tokens?: Token[] }).tokens;
    if (nested) await preRenderMermaid(nested, svgs);
  }
}

export async function renderPlanMarkdown(md: string): Promise<string> {
  const hl = await getHighlighter();

  const tokens = marked.lexer(md);
  const mermaidSvgs = new Map<string, string>();
  await preRenderMermaid(tokens, mermaidSvgs);

  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }: Tokens.Code) => {
    if (lang === 'mermaid-rendered' && mermaidSvgs.has(text)) {
      return `<div class="mermaid-diagram">${mermaidSvgs.get(text)}</div>`;
    }
    if (lang && hl.getLoadedLanguages().includes(lang)) {
      try {
        return hl.codeToHtml(text, { lang, theme: THEME });
      } catch {
        // Fall through to plain code block
      }
    }
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code>${escaped}</code></pre>`;
  };

  const rawHtml = marked.parser(tokens, { gfm: true, renderer }) as string;
  const linkedHtml = linkifyFilePaths(rawHtml);
  return DOMPurify.sanitize(linkedHtml, {
    ADD_TAGS: ['foreignObject'],
    ADD_ATTR: ['target'],
  });
}
