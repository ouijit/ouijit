import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../terminal/Icon';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
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

  // Keep within viewport
  const menuWidth = 200;
  const itemCount = items.filter((i) => !('separator' in i)).length;
  const sepCount = items.filter((i) => 'separator' in i).length;
  const menuHeight = 32 * itemCount + 9 * sepCount;
  const posX = Math.min(x, window.innerWidth - menuWidth);
  const posY = Math.min(y, window.innerHeight - menuHeight);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu fixed z-[2000] p-1 glass-bevel border border-black/60 rounded-[12px] overflow-hidden ${visible ? 'context-menu--visible opacity-100' : 'opacity-0'}`}
      style={{
        left: posX,
        top: posY,
        background: 'var(--color-terminal-bg, #171717)',
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 10px 30px rgba(0, 0, 0, 0.35)',
        transition: 'opacity 100ms ease',
      }}
    >
      {items.map((item, i) => {
        if ('separator' in item) {
          return <div key={`sep-${i}`} className="border-t border-white/10 mx-1 my-1" />;
        }
        return (
          <button
            key={i}
            className={`context-menu-item w-full px-2.5 py-1.5 rounded-[7px] text-xs text-text-primary bg-transparent border-none text-left transition-colors duration-100 ease-out flex items-center gap-1.5 whitespace-nowrap hover:bg-white/[0.08] [&>svg]:w-3 [&>svg]:h-3 [&>svg]:opacity-60 ${item.danger ? 'context-menu-item--danger hover:bg-error/10 hover:text-error' : ''}`}
            onClick={() => {
              setVisible(false);
              setTimeout(() => {
                onClose();
                item.onClick();
              }, 100);
            }}
          >
            {item.icon && <Icon name={item.icon} />}
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
