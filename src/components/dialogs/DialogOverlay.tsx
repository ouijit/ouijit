import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface DialogOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  maxWidth?: number;
  children: React.ReactNode;
}

export function DialogOverlay({ visible, onDismiss, maxWidth = 400, children }: DialogOverlayProps) {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onDismiss]);

  return createPortal(
    <div
      data-testid="dialog-overlay"
      data-visible={visible}
      className={`fixed inset-0 flex justify-center z-[10001] p-10 overflow-y-auto transition-opacity duration-200 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        mouseDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) onDismiss();
      }}
    >
      <div
        data-testid="dialog"
        className={`bg-surface rounded-[32px] shadow-lg w-[90%] p-6 border border-border overflow-hidden shrink-0 my-auto ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2.5'}`}
        style={{ maxWidth, transition: 'opacity 200ms ease-out, transform 200ms ease-out' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
