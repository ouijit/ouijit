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
      className={`task-context-menu${visible ? ' task-context-menu--visible' : ''}`}
      style={{ left: posX, top: posY }}
    >
      {items.map((item, i) => {
        if ('separator' in item) {
          return <div key={`sep-${i}`} className="task-context-menu-separator" />;
        }
        return (
          <button
            key={i}
            className={`task-context-menu-item${item.danger ? ' task-context-menu-item--danger' : ''}`}
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
