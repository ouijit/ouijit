import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Markdown for GitHub comment bodies.
 *
 * Deliberately thinner than `renderPlanMarkdown`: no mermaid rendering, no
 * shiki pass, and no file-path linkification. Comment bodies come from other
 * people over the network and are rendered constantly (every timeline item,
 * every thread comment), so this stays synchronous and cheap, and everything
 * goes through DOMPurify before it reaches the DOM.
 */
export function renderCommentMarkdown(md: string): string {
  if (!md.trim()) return '';
  const raw = marked.parse(md, { gfm: true, breaks: true, async: false });
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
}
