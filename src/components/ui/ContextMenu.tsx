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
  'context-menu-item w-full px-2.5 py-1.5 rounded-[7px] text-xs text-text-primary bg-transparent border-none text-left transition-colors duration-100 ease-out flex items-center gap-1.5 whitespace-nowrap hover:bg-white/[0.08] [&>svg]:w-3 [&>svg]:h-3 [&>svg]:opacity-60';

const PANEL_CLASS = 'p-1 glass-bevel border border-black/60 rounded-[12px]';
const PANEL_STYLE = {
  background: 'var(--color-terminal-bg, #171717)',
  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 10px 30px rgba(0, 0, 0, 0.35)',
} as const;

/** Renders the entries of a menu (or submenu). `onSelect` fires a leaf action. */
function MenuList({
  items,
  onSelect,
  openLeft,
}: {
  items: ContextMenuEntry[];
  onSelect: (onClick: () => void) => void;
  openLeft: boolean;
}) {
  return (
    <>
      {items.map((item, i) => {
        if ('separator' in item) {
          return <div key={`sep-${i}`} className="border-t border-white/10 mx-1 my-1" />;
        }
        if ('submenu' in item) {
          return (
            <div key={i} className="relative group/sub">
              <button type="button" className={`${ITEM_CLASS} justify-between`}>
                <span className="flex items-center gap-1.5">
                  {item.icon && <Icon name={item.icon} />}
                  {item.label}
                </span>
                <Icon name="caret-right" />
              </button>
              <div
                className={`absolute top-0 ${openLeft ? 'right-full mr-0.5' : 'left-full ml-0.5'} z-10 hidden min-w-[180px] group-hover/sub:block ${PANEL_CLASS}`}
                style={PANEL_STYLE}
              >
                <MenuList items={item.submenu} onSelect={onSelect} openLeft={openLeft} />
              </div>
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
