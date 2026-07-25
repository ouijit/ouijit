import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface TagFilterControlProps {
  /** Tags available to filter by (already de-duped). */
  tags: string[];
  /** Currently selected tag, or null for the "all" option. */
  value: string | null;
  /** Highlight the trigger button (e.g. filtering, or grouping by tag). */
  active: boolean;
  /** Whether the "all" row shows a check. */
  allSelected: boolean;
  /** Label for the null/all option. */
  allLabel?: string;
  /** Picked the "all" row. */
  onSelectAll: () => void;
  /** Picked a specific tag. */
  onSelectTag: (tag: string) => void;
  /** Trigger styling: a standalone rounded pill, or a button inside a segmented group. */
  variant?: 'pill' | 'segment';
  title?: string;
}

/**
 * Header dropdown that scopes the terminal stack/canvas to sessions whose task
 * carries the chosen tag. The `pill` variant (project view) filters only and
 * hides when no tags exist; the `segment` variant (home view) also toggles
 * tag grouping and always shows, acting as a plain toggle when no tags exist.
 * The menu is portaled to the body so it escapes the pill group's `overflow-hidden`.
 */
export function TagFilterControl({
  tags,
  value,
  active,
  allSelected,
  allLabel = 'All tags',
  onSelectAll,
  onSelectTag,
  variant = 'pill',
  title,
}: TagFilterControlProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  // Drop a stale filter when its tag no longer appears on any session.
  useEffect(() => {
    if (value && !tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      onSelectAll();
    }
  }, [tags, value, onSelectAll]);

  // The pill (project) control only filters, so it hides when there's nothing to
  // filter. The segment (home) control also toggles grouping, so it always shows;
  // with no tags it acts as a plain group-by-tag toggle (no menu).
  if (variant === 'pill' && tags.length === 0) return null;
  const hasMenu = tags.length > 0;

  const widthClass = hasMenu ? 'px-2 gap-0.5' : 'w-9';
  const triggerClass =
    variant === 'segment'
      ? `${widthClass} h-full flex items-center justify-center transition-all duration-150 ease-out [&>svg]:w-5 [&>svg]:h-5 ${
          active
            ? 'text-text-primary bg-background-tertiary'
            : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary'
        }`
      : `${widthClass} h-9 flex items-center justify-center bg-background-secondary glass-bevel relative border border-bezel rounded-[14px] transition-all duration-150 ease-out [&>svg]:w-5 [&>svg]:h-5 ${
          active
            ? 'text-text-primary bg-background-tertiary'
            : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
        }`;

  const wrapperClass = variant === 'segment' ? 'contents' : 'relative ml-3 [-webkit-app-region:no-drag]';

  return (
    <div className={wrapperClass}>
      <button
        ref={triggerRef}
        title={title ?? (value ? `Filtering by “${value}”` : 'Filter by tag')}
        className={triggerClass}
        onClick={() => (hasMenu ? setOpen((v) => !v) : onSelectAll())}
      >
        <Icon name="tag" />
        {hasMenu && (
          <span
            className={`flex items-center opacity-70 transition-transform duration-150 [&>svg]:w-3 [&>svg]:h-3 ${open ? 'rotate-180' : ''}`}
          >
            <Icon name="caret-down" />
          </span>
        )}
      </button>
      {open &&
        hasMenu &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed min-w-[180px] max-h-[320px] overflow-y-auto glass-bevel border border-bezel rounded-[12px] py-1.5 z-[10001] [-webkit-app-region:no-drag]"
            style={{
              top: menuPos.top,
              right: menuPos.right,
              background: 'var(--color-terminal-bg)',
              boxShadow: 'var(--shadow-menu)',
            }}
          >
            <TagOption
              label={allLabel}
              selected={allSelected}
              onClick={() => {
                onSelectAll();
                setOpen(false);
              }}
            />
            <div className="h-px bg-bezel my-1 mx-2" />
            {tags.map((tag) => (
              <TagOption
                key={tag}
                label={tag}
                selected={value != null && value.toLowerCase() === tag.toLowerCase()}
                onClick={() => {
                  onSelectTag(tag);
                  setOpen(false);
                }}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function TagOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-100 ${
        selected ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary'
      }`}
      onClick={onClick}
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">
        {selected && <Icon name="check" />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
