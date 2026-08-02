import type { ReactNode } from 'react';

/**
 * The pull request reads as one document, so its parts need to announce
 * themselves as you scroll past. A band header does that job and is typed like
 * a kanban column header, which is the app's existing answer to "this is what
 * the run of rows below me is".
 */

/** Section ids double as scroll targets for the rail. */
export const SECTION_IDS = {
  description: 'pr-section-description',
  checks: 'pr-section-checks',
  discussion: 'pr-section-discussion',
  files: 'pr-section-files',
} as const;

export type SectionId = keyof typeof SECTION_IDS;

export function BandHeader({ label, count, trailing }: { label: string; count?: number; trailing?: ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 px-3 h-[46px] shrink-0"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
    >
      <span className="text-[13px] font-medium text-text-secondary tracking-wide">
        {label}
        {count != null && <span className="text-text-secondary opacity-50 tracking-normal ml-1.5">{count}</span>}
      </span>
      {trailing && <span className="ml-auto flex items-center gap-1.5">{trailing}</span>}
    </div>
  );
}

/** One authored block: who, what they did, and the body. */
export function Entry({ author, action, children }: { author: string; action: string; children?: ReactNode }) {
  return (
    <article
      className="px-3 py-3"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
    >
      <div className="flex items-center gap-1.5 font-mono text-[10px] leading-tight text-text-secondary">
        <span className="text-text-primary">{author}</span>
        <span className="opacity-30">·</span>
        <span className="opacity-70">{action}</span>
      </div>
      {children && <div className="mt-2">{children}</div>}
    </article>
  );
}
