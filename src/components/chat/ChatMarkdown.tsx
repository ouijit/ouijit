import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { renderChatMarkdown, renderChatMarkdownHighlighted } from '../../utils/renderChatMarkdown';
import { openLink } from '../../links/openLink';
import { ImageViewer } from './ImageViewer';

function handleClick(event: MouseEvent<HTMLDivElement>): void {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="ouijit://"]');
  if (link) {
    event.preventDefault();
    void openLink(link.getAttribute('href')!);
    return;
  }
  copyCode(event);
}

function copyCode(event: MouseEvent<HTMLDivElement>): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]');
  const code = button?.closest('.chat-code')?.querySelector('pre')?.textContent;
  if (!button || code == null) return;
  void navigator.clipboard.writeText(code).then(() => {
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = 'Copy'), 1200);
  });
}

/**
 * A local image is almost always a screenshot taken on this screen, at its
 * pixel density, so it shows at the size it was on screen rather than at
 * twice that. Images from the web keep their own size.
 */
function atScreenSize(root: HTMLElement | null): (() => void) | void {
  if (!root || window.devicePixelRatio <= 1) return;
  // In a set each image fills a tile of its own instead.
  const images = [...root.querySelectorAll('img')].filter(
    (img) => img.src.startsWith('file:') && img.parentElement?.querySelectorAll(':scope > img').length === 1,
  );
  const fit = (img: HTMLImageElement) => {
    if (img.naturalWidth) img.style.width = `${img.naturalWidth / window.devicePixelRatio}px`;
  };
  for (const img of images) {
    if (img.complete) fit(img);
    else img.addEventListener('load', () => fit(img), { once: true });
  }
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
  const ref = useRef<HTMLDivElement>(null);
  const [viewing, setViewing] = useState<{ srcs: string[]; start: number } | null>(null);
  useEffect(() => atScreenSize(ref.current), [html]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const image = (event.target as HTMLElement).closest('img');
    if (!image) return handleClick(event);
    const set = [...(image.closest('.chat-images') ?? image.parentElement!).querySelectorAll('img')];
    setViewing({ srcs: set.map((img) => img.src), start: set.indexOf(image) });
  };

  if (!html) return null;
  return (
    <>
      <div
        ref={ref}
        className="app-markdown chat-markdown text-sm text-text-primary leading-relaxed break-words"
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {viewing && <ImageViewer srcs={viewing.srcs} start={viewing.start} onClose={() => setViewing(null)} />}
    </>
  );
}
