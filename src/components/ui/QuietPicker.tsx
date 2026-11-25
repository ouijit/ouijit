import { useState, type CSSProperties } from 'react';
import { Icon } from '../terminal/Icon';
import { MenuItem, MenuPopover } from './Menu';
import { SettingsTrigger } from './SettingsTrigger';

/** A setting's current value as quiet text with a caret. */
function QuietTrigger({
  triggerRef,
  label,
  value,
  open,
  onToggle,
  valueStyle,
}: {
  triggerRef: (el: HTMLButtonElement | null) => void;
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  valueStyle?: CSSProperties;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150"
      onClick={onToggle}
    >
      <span style={valueStyle}>{value}</span>
      <Icon name="caret-down" className="w-3 h-3 opacity-60" />
    </button>
  );
}

/** A setting's current value as quiet text with a caret, opening the app's menu of the choices. */
export function QuietPicker<T extends string>({
  label,
  value,
  options,
  optionLabel,
  optionDetail,
  onChange,
  inSettings = false,
}: {
  label: string;
  /** In Settings, it opens from Settings' button rather than quiet text. */
  inSettings?: boolean;
  value: T;
  options: readonly T[];
  optionLabel: (option: T) => string;
  optionDetail?: (option: T) => string;
  onChange: (option: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const Trigger = inSettings ? SettingsTrigger : QuietTrigger;
  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      className={`${optionDetail ? 'w-80' : 'w-56'} max-h-[22rem]`}
      trigger={(ref) => (
        <Trigger
          triggerRef={ref}
          label={label}
          value={optionLabel(value)}
          open={open}
          onToggle={() => setOpen(!open)}
        />
      )}
    >
      {options.map((option) => (
        <MenuItem
          key={option}
          label={optionLabel(option)}
          {...(optionDetail && { detail: optionDetail(option) })}
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
