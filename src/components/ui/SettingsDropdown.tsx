import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';
import { Icon } from '../terminal/Icon';

interface SettingsDropdownProps {
  open: boolean;
  /** Pass the state setter directly; a stable identity keeps the outside-click listener from re-binding per render. */
  onOpenChange: (open: boolean) => void;
  /** Tailwind width class applied to both the trigger and the menu, e.g. 'w-[13rem]'. */
  widthClass: string;
  ariaLabel: string;
  triggerLabel: ReactNode;
  triggerStyle?: CSSProperties;
  onMenuMouseLeave?: () => void;
  children: ReactNode;
}

/**
 * Settings-row dropdown: a fixed-width trigger button and a portaled,
 * floating listbox. Owns the floating-ui wiring, click-outside, and Escape
 * handling shared by the settings-panel pickers (theme, terminal font).
 */
export function SettingsDropdown({
  open,
  onOpenChange,
  widthClass,
  ariaLabel,
  triggerLabel,
  triggerStyle,
  onMenuMouseLeave,
  children,
}: SettingsDropdownProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (triggerRef.current) refs.setReference(triggerRef.current);
  }, [refs]);

  // Click-outside, deferred a tick so the click that opened the menu
  // doesn't immediately close it.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onOpenChange]);

  // Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`${widthClass} shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 text-sm bg-ink/[0.04] border border-ink/10 rounded-md text-text-primary hover:bg-ink/[0.06] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-light`}
      >
        <span className="truncate" style={triggerStyle}>
          {triggerLabel}
        </span>
        <Icon name="caret-down" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
      </button>
      {open &&
        createPortal(
          <div
            ref={(el) => {
              dropdownRef.current = el;
              refs.setFloating(el);
            }}
            role="listbox"
            aria-label={ariaLabel}
            onMouseLeave={onMenuMouseLeave}
            style={{
              ...floatingStyles,
              background: 'var(--color-terminal-bg)',
              boxShadow: 'var(--shadow-menu)',
            }}
            className={`${widthClass} max-h-[24rem] overflow-y-auto border border-bezel rounded-[12px] z-[1000] p-1`}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

interface SettingsDropdownOptionProps {
  label: string;
  hint?: string;
  fontFamily?: string;
  selected: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
}

export function SettingsDropdownOption({
  label,
  hint,
  fontFamily,
  selected,
  onClick,
  onMouseEnter,
}: SettingsDropdownOptionProps) {
  return (
    <button
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 hover:bg-ink/[0.08] transition-colors duration-100 ${
        selected ? 'text-text-primary bg-ink/[0.04]' : 'text-text-secondary'
      }`}
    >
      <span className="flex-1 truncate" style={fontFamily ? { fontFamily } : undefined}>
        {label}
      </span>
      {hint && <span className="text-[11px] text-text-tertiary shrink-0">{hint}</span>}
      {selected && <Icon name="check" className="w-3.5 h-3.5 text-text-primary shrink-0" />}
    </button>
  );
}

export function SettingsDropdownDivider() {
  return <div className="my-1 mx-1 border-t border-ink/[0.06]" />;
}
