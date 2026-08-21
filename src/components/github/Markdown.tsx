import { useMemo } from 'react';
import { renderCommentMarkdown } from '../../utils/renderCommentMarkdown';

/**
 * Rendered comment body. The HTML must already be sanitized by
 * `renderCommentMarkdown`: these strings arrive from other people over the
 * network and go straight into `dangerouslySetInnerHTML`.
 */
export function Markdown({ body, className = '' }: { body: string; className?: string }) {
  const html = useMemo(() => renderCommentMarkdown(body), [body]);
  if (!html) return null;
  return (
    <div
      className={`app-markdown text-sm text-text-primary leading-relaxed break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
