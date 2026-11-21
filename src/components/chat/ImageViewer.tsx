import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../terminal/Icon';

/** An image from a reply at full size, over the window, stepping through the set it came in. */
export function ImageViewer({ srcs, start, onClose }: { srcs: string[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const last = srcs.length - 1;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') setAt((i) => Math.min(last, i + 1));
      else if (event.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, last]);

  return createPortal(
    <div
      role="dialog"
      aria-label="Image"
      className="fixed inset-0 z-[10020] flex flex-col items-center justify-center gap-3 p-10 cursor-zoom-out"
      style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <img
        src={srcs[at]}
        alt=""
        className="max-w-full min-h-0 rounded-[12px]"
        style={{ maxHeight: srcs.length > 1 ? 'calc(100% - 36px)' : '100%', boxShadow: 'var(--shadow-menu)' }}
      />
      {srcs.length > 1 && (
        <div
          className="flex items-center gap-2 text-[13px] text-white/80 cursor-default"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Previous image"
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30"
            disabled={at === 0}
            onClick={() => setAt(at - 1)}
          >
            <Icon name="caret-left" className="w-3.5 h-3.5" />
          </button>
          <span className="tabular-nums">
            {at + 1} of {srcs.length}
          </span>
          <button
            type="button"
            aria-label="Next image"
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30"
            disabled={at === last}
            onClick={() => setAt(at + 1)}
          >
            <Icon name="caret-right" className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
