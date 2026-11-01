import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { renderChatMarkdown, renderChatMarkdownHighlighted } from '../../utils/renderChatMarkdown';

function copyCode(event: MouseEvent<HTMLDivElement>): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]');
  const code = button?.closest('.chat-code')?.querySelector('pre')?.textContent;
  if (!button || code == null) return;
  void navigator.clipboard.writeText(code).then(() => {
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = 'Copy'), 1200);
  });
}

/** A reply rendered as it streams, then with its code highlighted once it is complete. */
export function ChatMarkdown({ text, complete }: { text: string; complete: boolean }) {
  const plain = useMemo(() => renderChatMarkdown(text), [text]);
  const [highlighted, setHighlighted] = useState<{ text: string; html: string } | null>(null);

  useEffect(() => {
    if (!complete || !text.includes('```')) return;
    let current = true;
    void renderChatMarkdownHighlighted(text).then((html) => current && setHighlighted({ text, html }));
    return () => {
      current = false;
    };
  }, [text, complete]);

  const html = highlighted?.text === text ? highlighted.html : plain;
  if (!html) return null;
  return (
    <div
      className="app-markdown chat-markdown text-sm text-text-primary leading-relaxed break-words"
      onClick={copyCode}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
