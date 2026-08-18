import { Children, Fragment, type ReactNode } from 'react';

/**
 * The joined, extruded control the terminal header draws its panel tabs with.
 *
 * The classes are kept beside the group rather than folded into the terminal
 * header's copy, which carries hover-group wiring for its close affordances
 * that nothing here needs.
 */

export const segmentBase =
  'h-full px-2.5 flex items-center gap-1.5 border-none font-sans text-[13px] font-medium ' +
  'transition-colors duration-150 ease-out disabled:opacity-40 disabled:cursor-default';
export const segmentQuiet = 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary';
export const segmentAccent = 'bg-accent text-accent-ink hover:bg-accent';

export function SegmentedGroup({ children, floating }: { children: ReactNode; floating?: boolean }) {
  const segments = Children.toArray(children);
  if (segments.length === 0) return null;

  return (
    <div
      className={`inline-flex items-center h-7 glass-bevel relative border border-bezel rounded-[12px] overflow-hidden ${
        floating ? 'segmented-floating' : 'bg-background-secondary'
      }`}
    >
      {segments.map((segment, i) => (
        <Fragment key={i}>
          {i > 0 && <div aria-hidden className="w-px h-3 bg-ink/10 self-center" />}
          {segment}
        </Fragment>
      ))}
    </div>
  );
}
