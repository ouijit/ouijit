import { useState } from 'react';
import { Icon } from '../terminal/Icon';
import { MenuItem, MenuPopover } from './Menu';

/** A setting's current value as quiet text with a caret, opening the app's menu of the choices. */
export function QuietPicker<T extends string>({
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  optionLabel: (option: T) => string;
  onChange: (option: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      className="w-56 max-h-[22rem]"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150"
          onClick={() => setOpen(!open)}
        >
          {optionLabel(value)}
          <Icon name="caret-down" className="w-3 h-3 opacity-60" />
        </button>
      )}
    >
      {options.map((option) => (
        <MenuItem
          key={option}
          label={optionLabel(option)}
          selected={option === value}
          onClick={() => {
            setOpen(false);
            onChange(option);
          }}
        />
      ))}
    </MenuPopover>
  );
}
