import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate, type Placement } from '@floating-ui/react';
import { Icon } from '../terminal/Icon';

interface MenuPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rendered with the ref the surface is positioned and dismissed against. */
  trigger: (ref: (el: HTMLButtonElement | null) => void) => ReactNode;
  placement?: Placement;
  /** Sizing for the surface: how wide it sits and how tall it may grow. */
  className?: string;
  children: ReactNode;
}

/**
 * A portaled menu and the button that opens it.
 *
 * Held apart from `ActionMenu` because the trigger is the part that differs —
 * a segment of the action bar there, a full-width row in the file rail — while
 * the floating surface, the click-outside and the Escape that must not reach
 * the panel are the same wherever a menu is opened.
 */
export function MenuPopover({
  open,
  onOpenChange,
  trigger,
  placement = 'bottom-end',
  className = 'w-72 max-h-[22rem]',
  children,
}: MenuPopoverProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const { refs, floatingStyles } = useFloating({
    placement,
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  // Deferred a tick so the click that opened the menu doesn't close it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The panel closes the pull request on Escape, and a dialog closes
      // itself; a menu takes it first and closes only itself.
      //
      // On the window, not the document, because both of those listen on the
      // document in capture too — and there listeners run in the order they
      // were bound, so the dialog the menu was opened from is ahead of it.
      // Capture reaches the window before the document whatever the order,
      // which is the only way a menu can be sure of getting there first.
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onOpenChange]);

  return (
    <>
      {trigger((el) => {
        triggerRef.current = el;
        refs.setReference(el);
      })}

      {open &&
        createPortal(
          <div
            ref={(el) => {
              menuRef.current = el;
              refs.setFloating(el);
            }}
            role="menu"
            style={{ ...floatingStyles, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-menu)' }}
            // Above the dialog overlay (10001): a menu can be opened from
            // inside one, and a portal to the body is a sibling of it, so
            // nothing but the number keeps it in front.
            className={`${className} flex flex-col overflow-hidden glass-bevel border border-bezel rounded-[12px] z-[10002]`}
          >
            {/* The bevel is drawn on the surface and the scrolling happens
                inside it. On one element they fight: the ::before is laid out
                against the padding box, so it would scroll away from the edge
                it is meant to sit on the moment the menu is long enough. */}
            <div className="min-h-0 overflow-y-auto p-1">{children}</div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** One action in a menu. */
export function MenuItem({
  label,
  hint,
  disabled,
  title,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  title?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      className="w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent transition-colors duration-100"
      onClick={onClick}
    >
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[11px] text-text-tertiary shrink-0">{hint}</span>}
      {selected && <Icon name="check" className="w-3.5 h-3.5 text-accent shrink-0" />}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1 mx-1 border-t border-ink/[0.06]" />;
}

/** Free-form content in a menu — the review summary box uses this. */
export function MenuField({ children }: { children: ReactNode }) {
  return <div className="px-1.5 py-1.5">{children}</div>;
}
