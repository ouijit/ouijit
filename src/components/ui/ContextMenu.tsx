import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../terminal/Icon';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

export interface ContextMenuSubmenu {
  label: string;
  icon?: string;
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

const ITEM_CLASS =
  'context-menu-item w-full px-2.5 py-1.5 rounded-[7px] text-xs text-text-primary bg-transparent border-none text-left transition-colors duration-100 ease-out flex items-center gap-1.5 whitespace-nowrap hover:bg-ink/[0.08] [&>svg]:w-3 [&>svg]:h-3 [&>svg]:opacity-60';

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
                <span className="flex items-center gap-1.5">
                  {item.icon && <Icon name={item.icon} />}
                  {item.label}
                </span>
                <Icon name="caret-right" />
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
        return (
          <button
            key={i}
            type="button"
            className={`${ITEM_CLASS} ${item.danger ? 'context-menu-item--danger hover:bg-error/10 hover:text-error' : ''}`}
            onClick={() => onSelect(item.onClick)}
          >
            {item.icon && <Icon name={item.icon} />}
            {item.label}
          </button>
        );
      })}
    </>
  );
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

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
  const menuWidth = 200;
  const submenuWidth = 180;
  const itemCount = items.filter((i) => !('separator' in i)).length;
  const sepCount = items.filter((i) => 'separator' in i).length;
  const menuHeight = 32 * itemCount + 9 * sepCount;
  const posX = Math.min(x, window.innerWidth - menuWidth);
  const posY = Math.min(y, window.innerHeight - menuHeight);
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
