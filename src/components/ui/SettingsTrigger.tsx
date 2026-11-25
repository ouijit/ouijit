import type { CSSProperties } from 'react';
import { Icon } from '../terminal/Icon';

/** The button a menu in Settings opens from, showing the setting's current value. */
export function SettingsTrigger({
  triggerRef,
  label,
  value,
  open,
  onToggle,
  valueClassName = '',
  valueStyle,
}: {
  triggerRef: (el: HTMLButtonElement | null) => void;
  label?: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  valueClassName?: string;
  valueStyle?: CSSProperties;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      {...(label && { 'aria-label': label })}
      className="btn-secondary btn-compact shrink-0 max-w-[14rem] flex items-center gap-1.5"
      onClick={onToggle}
    >
      <span className={`truncate ${valueClassName}`} style={valueStyle}>
        {value}
      </span>
      <Icon name="caret-down" className="w-3 h-3 shrink-0" />
    </button>
  );
}
