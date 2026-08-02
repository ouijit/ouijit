import { useMemo } from 'react';
import { renderCommentMarkdown } from '../../utils/renderCommentMarkdown';

/**
 * Rendered comment body. The HTML is sanitized in `renderCommentMarkdown`
 * before it gets here — these strings come from other people over the network,
 * so nothing untrusted reaches `dangerouslySetInnerHTML` unfiltered.
 */
export function Markdown({ body, className = '' }: { body: string; className?: string }) {
  const html = useMemo(() => renderCommentMarkdown(body), [body]);
  if (!html) return null;
  return (
    <div
      className={`github-markdown text-sm text-text-primary leading-relaxed break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
