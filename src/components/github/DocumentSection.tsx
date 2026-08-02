import { useState, type ReactNode } from 'react';
import { Icon } from '../terminal/Icon';

/**
 * The parts a pull request document is built from.
 *
 * One rule per boundary is the whole discipline here. A band draws the rule
 * beneath itself, and its header draws one only when something is open below
 * it, so no two lines ever land next to each other. Rows inside a band are
 * separated by space and type, not by more lines.
 */

const HAIRLINE = '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)';

/** Section ids double as scroll targets for the rail. */
export const SECTION_IDS = {
  description: 'pr-section-description',
  checks: 'pr-section-checks',
  discussion: 'pr-section-discussion',
  files: 'pr-section-files',
} as const;

export type SectionId = keyof typeof SECTION_IDS;

interface BandProps {
  id?: string;
  label: string;
  count?: number;
  /** Stands in for the contents when shut, so closing loses no information. */
  summary?: ReactNode;
  /** Bands with nothing worth reading open shut; the summary says what is in them. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Band({ id, label, count, summary, defaultOpen = true, children }: BandProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section id={id} style={{ borderBottom: HAIRLINE }}>
      <button
        type="button"
        aria-expanded={open}
        className="w-full h-9 flex items-center gap-2 px-3 text-left hover:bg-ink/[0.03] transition-colors duration-100"
        style={open ? { borderBottom: HAIRLINE } : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon
          name="caret-right"
          className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <span className="text-[13px] font-medium text-text-secondary tracking-wide">
          {label}
          {count != null && count > 0 && (
            <span className="text-text-secondary opacity-50 tracking-normal ml-1.5">{count}</span>
          )}
        </span>
        {summary && (
          <span className="ml-auto font-mono text-[11px] text-text-tertiary truncate min-w-0 pl-3">{summary}</span>
        )}
      </button>
      {open && children}
    </section>
  );
}

/** The list panel's section heading. Named, counted, never collapsible. */
export function BandHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-3 h-9 shrink-0" style={{ borderBottom: HAIRLINE }}>
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
    <article className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] leading-tight text-text-secondary">
        <span className="text-text-primary">{author}</span>
        <span className="opacity-30">·</span>
        <span className="opacity-70">{action}</span>
      </div>
      {children && <div className="mt-1.5">{children}</div>}
    </article>
  );
}
