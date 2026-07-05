import type { ReactNode } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Extra classes for the label text (e.g. a smaller size). Defaults to text-sm. */
  textClassName?: string;
}

/**
 * Accent checkbox with an inline label. Desktop app, so the row uses
 * cursor-default rather than a pointer (see CLAUDE.md design rules).
 */
export function Checkbox({ checked, onChange, label, textClassName = 'text-sm text-text-secondary' }: CheckboxProps) {
  return (
    <label className="flex items-center gap-2 cursor-default">
      <input
        type="checkbox"
        className="w-4 h-4 accent-accent !cursor-default"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={textClassName}>{label}</span>
    </label>
  );
}
