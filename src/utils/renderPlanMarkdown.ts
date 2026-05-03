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

const MERMAID_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';

function ensureMermaid(): void {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'strict',
    fontFamily: MERMAID_FONT_FAMILY,
    // Render labels as native SVG <text> elements rather than <foreignObject>
    // wrappers around HTML. Keeps DOMPurify config trivial and dodges the
    // namespace edge cases that strip child content of foreignObject.
    flowchart: { htmlLabels: false },
  });
  mermaidInitialized = true;
}

async function renderMermaidBlock(source: string): Promise<string | null> {
  ensureMermaid();
  const id = `mermaid-${Date.now()}-${++mermaidCounter}`;
  // Mermaid measures layout against a real DOM node. Owning the container lets
  // us guarantee cleanup instead of chasing scratch elements mermaid creates.
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
  document.body.appendChild(container);
  try {
    const { svg } = await mermaid.render(id, source, container);
    return svg;
  } catch (err) {
    planRenderLog.warn('mermaid render failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    container.remove();
  }
}

function isCodeToken(token: Token): token is Tokens.Code {
  return token.type === 'code';
}

function collectMermaidTokens(tokens: Token[], out: Tokens.Code[]): void {
  for (const token of tokens) {
    if (isCodeToken(token) && token.lang === 'mermaid') {
      out.push(token);
      continue;
    }
    const nested = (token as { tokens?: Token[] }).tokens;
    if (nested) collectMermaidTokens(nested, out);
  }
}

async function preRenderMermaid(tokens: Token[], svgs: Map<string, string>): Promise<void> {
  const codeTokens: Tokens.Code[] = [];
  collectMermaidTokens(tokens, codeTokens);
  if (codeTokens.length === 0) return;

  const svgResults = await Promise.all(codeTokens.map((t) => renderMermaidBlock(t.text)));

  codeTokens.forEach((token, i) => {
    const svg = svgResults[i];
    if (!svg) return;
    const placeholder = `__OUIJIT_MERMAID_${svgs.size}__`;
    svgs.set(placeholder, svg);
    token.text = placeholder;
    token.lang = 'mermaid-rendered';
  });
}

export async function renderPlanMarkdown(md: string): Promise<string> {
  const hl = await getHighlighter();

  const tokens = marked.lexer(md, { gfm: true });
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

  const rawHtml = marked.parser(tokens, { renderer }) as string;
  const linkedHtml = linkifyFilePaths(rawHtml);
  return DOMPurify.sanitize(linkedHtml);
}
