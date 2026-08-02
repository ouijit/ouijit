import type { ReactNode } from 'react';

/** Which part of a pull request the pane is showing. Files carry their path. */
export type PrSection = 'description' | 'checks' | 'discussion' | 'files' | `file:${string}`;

export function filePathOf(section: PrSection): string | null {
  return section.startsWith('file:') ? section.slice(5) : null;
}

/** The list panel's section heading. */
export function BandHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div
      className="flex items-center gap-2 px-3 h-9 shrink-0"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
    >
      <span className="text-[13px] font-medium text-text-secondary tracking-wide">
        {label}
        {count != null && <span className="text-text-secondary opacity-50 tracking-normal ml-1.5">{count}</span>}
      </span>
    </div>
  );
}

/**
 * One authored block. Consecutive entries are told apart by their byline and
 * the space around them rather than by a rule between every one, which at four
 * or five comments reads as a table of strangers.
 */
export function Entry({ author, action, children }: { author: string; action: string; children?: ReactNode }) {
  return (
    <article className="px-4 py-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] leading-tight text-text-secondary">
        <span className="text-text-primary">{author}</span>
        <span className="opacity-30">·</span>
        <span className="opacity-70">{action}</span>
      </div>
      {children && <div className="mt-1.5">{children}</div>}
    </article>
  );
}
