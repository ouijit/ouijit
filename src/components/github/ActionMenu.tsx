import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';
import { Icon } from '../terminal/Icon';
import { segmentAccent, segmentBase, segmentQuiet } from './SegmentedGroup';

interface ActionMenuProps {
  label: string;
  /** The filled segment — the one primary action in the group. */
  accent?: boolean;
  /** An accent dot before the label, flagging state rather than naming an action. */
  dot?: boolean;
  disabled?: boolean;
  title?: string;
  children: (close: () => void) => ReactNode;
}

/**
 * One segment of a joined control that opens a menu, cut from the same cloth as
 * the settings dropdown: same floating-ui wiring, same portaled surface, same
 * option rows.
 *
 * Consequential actions live in here rather than sitting on the bar as their
 * own coloured buttons. Three verdict buttons side by side gave equal weight to
 * choices that are not equal, and spent the app's two status colours — which
 * everywhere else mean added and removed — on chrome.
 */
export function ActionMenu({ label, accent, dot, disabled, title, children }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (triggerRef.current) refs.setReference(triggerRef.current);
  }, [refs]);

  // Deferred a tick so the click that opened the menu doesn't close it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The panel closes the pull request on Escape; a menu takes it first.
      e.stopPropagation();
      setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`${segmentBase} ${
          accent ? segmentAccent : open ? 'bg-background-tertiary text-text-primary' : segmentQuiet
        }`}
        onClick={() => setOpen(!open)}
      >
        {dot && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
        {label}
        <Icon name="caret-down" className="w-3 h-3 opacity-60" />
      </button>

      {open &&
        createPortal(
          <div
            ref={(el) => {
              menuRef.current = el;
              refs.setFloating(el);
            }}
            role="menu"
            style={{ ...floatingStyles, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-menu)' }}
            className="w-72 max-h-[22rem] overflow-y-auto border border-bezel rounded-[12px] z-[1000] p-1"
          >
            {children(() => setOpen(false))}
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
