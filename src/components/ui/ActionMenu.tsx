import { useState, type ReactNode } from 'react';
import type { Placement } from '@floating-ui/react';
import { Icon } from '../terminal/Icon';
import { MenuPopover } from './Menu';
import { segmentAccent, segmentBase, segmentQuiet } from './SegmentedGroup';

interface ActionMenuProps {
  label: string;
  /** The filled segment — the one primary action in the group. */
  accent?: boolean;
  /** An accent dot before the label, flagging state rather than naming an action. */
  dot?: boolean;
  disabled?: boolean;
  title?: string;
  /** Which way the menu opens — upward, for a group that sits at the foot of a pane. */
  placement?: Placement;
  children: (close: () => void) => ReactNode;
}

/**
 * One segment of a joined control that opens a menu, cut from the same cloth as
 * the settings dropdown: same floating-ui wiring, same portaled surface, same
 * option rows.
 *
 * Consequential actions live in here rather than on the bar as coloured
 * buttons: the app's two status colours mean added and removed everywhere
 * else.
 */
export function ActionMenu({ label, accent, dot, disabled, title, placement, children }: ActionMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      trigger={(ref) => (
        <button
          ref={ref}
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
      )}
    >
      {children(() => setOpen(false))}
    </MenuPopover>
  );
}
