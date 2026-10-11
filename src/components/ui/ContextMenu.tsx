import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../terminal/Icon';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
  /** Marks the current choice among siblings, which keep the space so labels line up. */
  checked?: boolean;
  /** Leave the menu open after the click, for a choice that sets up what is picked next. */
  keepOpen?: boolean;
  /** An icon button at the end of the row, shown under the pointer, doing something other than the row. */
  secondary?: { icon: string; label: string; onClick: () => void };
}

export interface ContextMenuSubmenu {
  label: string;
  icon?: string;
  /** The current choice, shown at the row's end; the label then reads as a heading over the rows that follow. */
  value?: string;
  /** Nested entries shown in a hover flyout. */
  submenu: ContextMenuEntry[];
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSubmenu | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

const ITEM_LAYOUT =
  'px-2.5 py-1.5 rounded-[7px] text-xs text-text-primary bg-transparent border-none text-left transition-colors duration-100 ease-out flex items-center gap-1.5 whitespace-nowrap [&>svg]:w-3 [&>svg]:h-3 [&>svg]:opacity-60';
const ITEM_CLASS = `context-menu-item w-full ${ITEM_LAYOUT} hover:bg-ink/[0.08]`;
const SECONDARY_CLASS =
  'w-6 h-6 shrink-0 flex items-center justify-center rounded-[6px] border-none bg-transparent text-text-tertiary opacity-0 transition-[opacity,background-color] duration-100 ease-out group-hover/row:opacity-100 focus-visible:opacity-100 hover:bg-ink/[0.1] hover:text-text-primary [&>svg]:w-3 [&>svg]:h-3';

/** The bevel is an inset `::before`, so whatever wears this has to be positioned. */
const PANEL_CLASS = 'p-1 glass-bevel border border-bezel rounded-[12px]';
const PANEL_STYLE = {
  background: 'var(--color-terminal-bg)',
  boxShadow: 'var(--shadow-menu)',
} as const;

/**
 * Without it only a dead-sideways path reaches a flyout: a diagonal one leaves
 * the row over the rows below, and the flyout goes with it.
 */
const SUBMENU_CLOSE_DELAY = 300;

const EDGE_MARGIN = 8;

function MenuList({
  items,
  onSelect,
  openLeft,
}: {
  items: ContextMenuEntry[];
  onSelect: (onClick: () => void) => void;
  openLeft: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const openSubmenu = (index: number) => {
    cancelClose();
    setOpenIndex(index);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenIndex(null), SUBMENU_CLOSE_DELAY);
  };
  useEffect(() => cancelClose, []);

  return (
    <>
      {items.map((item, i) => {
        if ('separator' in item) {
          return <div key={`sep-${i}`} className="border-t border-ink/10 mx-1 my-1" />;
        }
        if ('submenu' in item) {
          const open = openIndex === i;
          return (
            <div key={i} className="relative" onMouseEnter={() => openSubmenu(i)} onMouseLeave={scheduleClose}>
              <button type="button" className={`${ITEM_CLASS} justify-between ${open ? 'bg-ink/[0.08]' : ''}`}>
                <span className={`flex items-center gap-1.5 ${item.value ? 'text-[11px] text-text-tertiary' : ''}`}>
                  {item.icon && <Icon name={item.icon} />}
                  {item.label}
                </span>
                {item.value ? (
                  <span className="flex items-center gap-1 text-[11px] text-text-secondary">
                    {item.value}
                    <Icon name="caret-right" />
                  </span>
                ) : (
                  <Icon name="caret-right" />
                )}
              </button>
              {/* Nested in the row, so moving into it fires no mouseleave, and the
                  padding around it covers the gap between the two panels. */}
              {open && (
                <div className={`absolute -top-2 ${openLeft ? 'right-full pr-1.5' : 'left-full pl-1.5'} py-2 z-10`}>
                  <div className={`relative min-w-[180px] ${PANEL_CLASS}`} style={PANEL_STYLE}>
                    <MenuList items={item.submenu} onSelect={onSelect} openLeft={openLeft} />
                  </div>
                </div>
              )}
            </div>
          );
        }
        const row = (
          <button
            type="button"
            className={
              item.secondary
                ? `context-menu-item flex-1 min-w-0 ${ITEM_LAYOUT}`
                : `${ITEM_CLASS} ${item.danger ? 'context-menu-item--danger hover:bg-error/10 hover:text-error' : ''}`
            }
            onClick={() => (item.keepOpen ? item.onClick() : onSelect(item.onClick))}
          >
            {item.checked !== undefined && <Icon name="check" className={item.checked ? '' : 'invisible'} />}
            {item.icon && <Icon name={item.icon} />}
            {item.label}
          </button>
        );
        if (!item.secondary) return <Fragment key={i}>{row}</Fragment>;
        const { secondary } = item;
        return (
          <div key={i} className="group/row flex items-center pr-1 rounded-[7px] hover:bg-ink/[0.08]">
            {row}
            <button
              type="button"
              aria-label={secondary.label}
              className={SECONDARY_CLASS}
              onClick={() => onSelect(secondary.onClick)}
            >
              <Icon name={secondary.icon} />
            </button>
          </div>
        );
      })}
    </>
  );
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [renderedWidth, setRenderedWidth] = useState(0);

  useLayoutEffect(() => {
    setRenderedWidth(menuRef.current?.offsetWidth ?? 0);
  }, []);

  // Position and animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Click outside to dismiss
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setVisible(false);
        setTimeout(onClose, 100);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const select = (onClick: () => void) => {
    setVisible(false);
    setTimeout(() => {
      onClose();
      onClick();
    }, 100);
  };

  // Keep within viewport. Only top-level entries drive the height clamp;
  // submenu flyouts open to the side.
  const menuWidth = Math.max(200, renderedWidth);
  const submenuWidth = 180;
  const itemCount = items.filter((i) => !('separator' in i)).length;
  const sepCount = items.filter((i) => 'separator' in i).length;
  const menuHeight = 32 * itemCount + 9 * sepCount;
  const posX = Math.min(x, window.innerWidth - menuWidth - EDGE_MARGIN);
  const posY = Math.min(y, window.innerHeight - menuHeight - EDGE_MARGIN);
  // Flip submenu flyouts to the left when they would overflow the right edge.
  const openLeft = posX + menuWidth + submenuWidth > window.innerWidth;

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu fixed z-[2000] ${PANEL_CLASS} ${visible ? 'context-menu--visible opacity-100' : 'opacity-0'}`}
      style={{
        left: posX,
        top: posY,
        ...PANEL_STYLE,
        transition: 'opacity 100ms ease',
      }}
    >
      <MenuList items={items} onSelect={select} openLeft={openLeft} />
    </div>,
    document.body,
  );
}
