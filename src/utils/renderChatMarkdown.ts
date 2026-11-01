import { marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { currentShikiTheme } from '../theme/shikiTheme';
import { getHighlighter } from './renderPlanMarkdown';

type Highlighter = Awaited<ReturnType<typeof getHighlighter>>;

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function codeBlock(text: string, lang: string | undefined, highlighter: Highlighter | null): string {
  let body = `<pre><code>${escape(text)}</code></pre>`;
  if (highlighter && lang && highlighter.getLoadedLanguages().includes(lang)) {
    try {
      body = highlighter.codeToHtml(text, { lang, theme: currentShikiTheme() });
    } catch {
      // Unhighlighted is still readable.
    }
  }
  const label = lang ? `<span>${escape(lang)}</span>` : '<span></span>';
  return `<div class="chat-code"><div class="chat-code-bar">${label}<button type="button" data-copy-code>Copy</button></div>${body}</div>`;
}

function render(md: string, highlighter: Highlighter | null): string {
  if (!md.trim()) return '';
  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }: Tokens.Code) => codeBlock(text, lang?.split(/\s/)[0], highlighter);
  const raw = marked.parse(md, { gfm: true, breaks: true, async: false, renderer }) as string;
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel', 'data-copy-code'] });
}

/** An agent's reply as HTML, without highlighting: cheap enough to rerun on every streamed chunk. */
export function renderChatMarkdown(md: string): string {
  return render(md, null);
}

/** The same, with code highlighted, for a reply that has finished streaming. */
export async function renderChatMarkdownHighlighted(md: string): Promise<string> {
  return render(md, await getHighlighter());
}
