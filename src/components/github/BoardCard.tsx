import type { ReactNode } from 'react';
import { Icon } from '../terminal/Icon';

/**
 * The pieces a GitHub board card is built from, cut to the same geometry as a
 * kanban card.
 *
 * The board is the surface. Nothing inside it gets a border, a bevel, or a
 * radius of its own: cards run full bleed in their column and are separated by
 * the same hairline the kanban uses, so a column of pull requests reads as the
 * same kind of thing as a column of tasks.
 */

interface BoardCardProps {
  onClick?: () => void;
  /** Says where the card goes, since a whole-card click is not self-evident. */
  title?: string;
  children: ReactNode;
}

export function BoardCard({ onClick, title, children }: BoardCardProps) {
  return (
    <div
      className="group px-3 py-3.5 ease-out [-webkit-app-region:no-drag] hover:bg-black/10 active:bg-black/[0.12]"
      style={{
        background: 'var(--color-terminal-bg)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)',
        transition: 'background 150ms ease-out',
      }}
      title={title}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/** Title line: a leading state glyph, the title, and an optional trailing glyph. */
export function BoardCardTitle({
  icon,
  iconClassName,
  title,
  trailing,
}: {
  icon: string;
  iconClassName?: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon name={icon} className={`w-4 h-4 shrink-0 mt-px ${iconClassName ?? ''}`} />
      <span className="flex-1 font-mono text-sm font-medium text-text-primary min-w-0 break-words">{title}</span>
      {trailing}
    </div>
  );
}

/**
 * Pill chip, same shape as the task badge on a kanban card. `tone` is any CSS
 * color (a token var included) and colors both the text and its wash; without
 * one the chip is neutral ink, which is what the plain number chip wants.
 */
export function BoardChip({ tone, title, children }: { tone?: string; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-0.5 shrink-0 font-mono text-[11px] leading-none px-2 py-1 rounded-full whitespace-nowrap"
      style={{
        color: tone ?? 'color-mix(in srgb, var(--color-ink) 45%, transparent)',
        background: tone
          ? `color-mix(in srgb, ${tone} 12%, transparent)`
          : 'color-mix(in srgb, var(--color-ink) 4%, transparent)',
      }}
    >
      {children}
    </span>
  );
}

/** `#123`, with the sigil dimmed the way the kanban task badge dims its own. */
export function NumberChip({ number }: { number: number }) {
  return (
    <BoardChip>
      <span className="opacity-50">#</span>
      {number}
    </BoardChip>
  );
}

/** The row of chips under the title. Renders nothing when it would be empty. */
export function BoardChipRow({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex items-center gap-1 flex-wrap">{children}</div>;
}

/** Author, age, and size: the quiet line, in the same type as a terminal row. */
export function BoardMeta({ parts }: { parts: ReactNode[] }) {
  const present = parts.filter(Boolean);
  if (present.length === 0) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap font-mono text-[10px] leading-tight text-text-secondary">
      {present.map((part, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="opacity-30">·</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

/**
 * A child row hanging off the card, drawn with the same tree glyph the kanban
 * card uses for a task's terminals. A pull request's checked-out task and an
 * issue's task are the same kind of relation, so they get the same shape.
 */
export function BoardSubRow({
  glyph = '└─',
  onClick,
  title,
  muted = false,
  children,
}: {
  glyph?: string;
  onClick?: () => void;
  title?: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col" style={{ paddingTop: 3 }}>
      <div
        className={`flex flex-row items-center gap-1.5 ${onClick ? 'hover:bg-ink/[0.06] active:bg-ink/[0.03]' : ''}`}
        style={{ padding: '3px 2px', borderRadius: 3, transition: 'background 0.1s ease' }}
        title={title}
        onClick={
          onClick &&
          ((e) => {
            e.stopPropagation();
            onClick();
          })
        }
      >
        <span className="font-mono text-sm leading-none text-text-secondary shrink-0 select-none opacity-40">
          {glyph}
        </span>
        <span
          className={`flex items-center gap-1.5 font-mono text-[10px] leading-tight truncate min-w-0 ${
            muted ? 'text-text-tertiary group-hover:text-text-secondary' : 'text-text-secondary'
          }`}
        >
          {children}
        </span>
      </div>
    </div>
  );
}

/** GitHub labels, capped so a heavily-labelled row can't push the card wide. */
export function BoardLabels({ labels, max = 2 }: { labels: { name: string; color: string }[]; max?: number }) {
  return (
    <>
      {labels.slice(0, max).map((label) => (
        <span
          key={label.name}
          className="shrink-0 font-mono text-[10px] leading-none px-1.5 py-1 rounded-full whitespace-nowrap"
          style={labelChipStyle(label.color)}
        >
          {label.name}
        </span>
      ))}
    </>
  );
}

function labelChipStyle(color: string): { background: string; color: string } {
  const hex = color.startsWith('#') ? color : `#${color}`;
  return {
    background: `color-mix(in srgb, ${hex} 15%, transparent)`,
    color: `color-mix(in srgb, ${hex} 75%, var(--color-ink))`,
  };
}

/** An empty column says what would be in it, not that something went wrong. */
export function BoardColumnEmpty({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-3 py-8">
      <span className="font-mono text-[11px] text-text-tertiary opacity-50 text-center">{message}</span>
    </div>
  );
}
