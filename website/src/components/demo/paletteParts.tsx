import type { ReactNode, Ref } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';

/**
 * The command palette's own pieces, copied from CommandPalette and
 * palette/PaletteRow. Shared by the powertools tile, which shows one static
 * slice of it, and the hero window, which opens the whole thing.
 */

export function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <kbd className="font-mono text-[10px] leading-none px-1.5 py-1 rounded bg-ink/[0.06] text-text-tertiary">
        {keys}
      </kbd>
      <span className="truncate">{label}</span>
    </span>
  );
}

export function PaletteHeader({ query, placeholder }: { query?: ReactNode; placeholder?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/[0.06] shrink-0">
      <span className="shrink-0 text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
        <Icon name="magnifying-glass" />
      </span>
      <span className="flex-1 min-w-0 text-sm text-text-primary">
        {query ?? <span className="text-text-tertiary">{placeholder}</span>}
        <span className="terminal-cursor terminal-cursor--dim" />
      </span>
    </div>
  );
}

export function PaletteGroupTitle({ children }: { children: ReactNode }) {
  return (
    <div
      className="sticky top-0 z-10 px-3 pt-2 pb-1 text-[11px] text-ink/40"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      {children}
    </div>
  );
}

export function PaletteFooter({ action }: { action?: string }) {
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-ink/[0.06] text-[11px] text-ink/40">
      <KeyHint keys="↑↓" label="Navigate" />
      {action && <KeyHint keys="↵" label={action} />}
      <span className="flex-1" />
      <KeyHint keys="esc" label="Close" />
    </div>
  );
}

export interface PaletteRowProps {
  leading: ReactNode;
  title: ReactNode;
  /** Dim detail beside the title, in PaletteRow's own hint slot. */
  hint?: ReactNode;
  context: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  rowRef?: Ref<HTMLDivElement>;
  onHover?: () => void;
}

export function PaletteRow({ leading, title, hint, context, meta, selected = false, rowRef, onHover }: PaletteRowProps) {
  return (
    <div
      ref={rowRef}
      onMouseMove={onHover}
      className="flex items-center gap-2.5 px-3 h-9 cursor-default transition-colors duration-100 ease-out"
      style={
        selected
          ? {
              background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
              boxShadow: 'inset 2px 0 0 0 var(--color-accent)',
            }
          : undefined
      }
    >
      <span className="w-12 shrink-0 flex items-center">{leading}</span>
      <span className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-[13px] truncate text-text-primary">{title}</span>
        {hint && <span className="text-[11px] text-text-tertiary truncate shrink-0 max-w-[9rem]">{hint}</span>}
      </span>
      {/* Sized, not fixed: the palette's own columns, but free to give way in
          a tile narrower than the window the app draws them in. */}
      <span className="w-32 min-w-0 text-[11px] text-text-tertiary truncate">{context}</span>
      <span className="w-28 min-w-0 text-right text-[11px] text-text-tertiary truncate">{meta}</span>
    </div>
  );
}

/** A task's live shell, drawn as a branch off the task's own row. */
export function PaletteBranchRow({
  title,
  summaryType,
  last,
  selected = false,
  rowRef,
  onHover,
}: {
  title: string;
  summaryType: string;
  last: boolean;
  selected?: boolean;
  rowRef?: Ref<HTMLDivElement>;
  onHover?: () => void;
}) {
  return (
    <div
      ref={rowRef}
      onMouseMove={onHover}
      className="flex items-center gap-2.5 px-3 h-6 cursor-default transition-colors duration-100 ease-out"
      style={
        selected
          ? {
              background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
              boxShadow: 'inset 2px 0 0 0 var(--color-accent)',
            }
          : undefined
      }
    >
      <span className="flex items-center gap-1.5 min-w-0 pl-3">
        <span className="font-mono text-sm leading-none text-text-secondary shrink-0 select-none opacity-40">
          {last ? '└─' : '├─'}
        </span>
        <StatusDot summaryType={summaryType} />
        <span className="font-mono text-[10px] leading-tight text-text-secondary truncate min-w-0">{title}</span>
      </span>
    </div>
  );
}
