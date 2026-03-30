import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';

interface WhatsNewDialogProps {
  version: string;
  notes: string;
  onClose: () => void;
}

/** Minimal markdown-to-HTML for GitHub release notes (headers, bullets, bold, code, links). */
function renderMarkdown(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      // Headers
      if (line.startsWith('### '))
        return `<h4 class="font-semibold text-text-primary mt-3 mb-1">${esc(line.slice(4))}</h4>`;
      if (line.startsWith('## '))
        return `<h3 class="font-semibold text-text-primary text-base mt-3 mb-1">${esc(line.slice(3))}</h3>`;

      // Bullet points
      const bulletMatch = line.match(/^[-*] (.+)/);
      if (bulletMatch)
        return `<div class="flex gap-1.5 ml-1"><span class="text-text-secondary shrink-0">•</span><span>${inlineFormat(bulletMatch[1])}</span></div>`;

      // Empty lines
      if (line.trim() === '') return '<div class="h-2"></div>';

      // Regular text
      return `<p>${inlineFormat(line)}</p>`;
    })
    .join('');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function inlineFormat(s: string): string {
  let out = esc(s);
  // Bold
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong class="text-text-primary font-medium">$1</strong>');
  // Inline code
  out = out.replace(/`(.+?)`/g, '<code class="px-1 py-0.5 rounded bg-white/5 text-xs font-mono">$1</code>');
  // Links [text](url)
  out = out.replace(/\[(.+?)\]\((.+?)\)/g, '<a class="text-accent hover:underline" data-href="$2">$1</a>');
  return out;
}

export function WhatsNewDialog({ version, notes, onClose }: WhatsNewDialogProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const href = target.closest('[data-href]')?.getAttribute('data-href');
    if (href) {
      e.preventDefault();
      window.api.openExternal(href);
    }
  }, []);

  return (
    <DialogOverlay visible={visible} onDismiss={dismiss} maxWidth={480}>
      <h2 className="text-lg font-semibold text-text-primary mb-1 text-center">What&apos;s New</h2>
      <p className="text-xs text-text-secondary text-center mb-4">v{version}</p>
      <div
        className="text-sm text-text-secondary leading-relaxed max-h-[60vh] overflow-y-auto pr-1"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(notes) }}
      />
      <div className="flex justify-end mt-5">
        <button
          className="inline-flex items-center justify-center gap-2 px-5 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98]"
          onClick={dismiss}
        >
          Got it
        </button>
      </div>
    </DialogOverlay>
  );
}
