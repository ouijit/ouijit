import { createPortal } from 'react-dom';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';

/**
 * Per-type leading badge: a tinted circle with a Phosphor glyph. Success and
 * error carry the status accent colors from the design system; info stays
 * neutral so routine messages don't read as alarming.
 */
const TYPE_BADGE: Record<'info' | 'success' | 'error', { icon: string; className: string }> = {
  success: { icon: 'check', className: 'bg-success/15 text-success' },
  error: { icon: 'prohibit', className: 'bg-error/15 text-error' },
  info: { icon: 'info', className: 'bg-white/[0.08] text-text-secondary' },
};

export function ToastContainer() {
  const toasts = useProjectStore((s) => s.toasts);
  const removeToast = useProjectStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return createPortal(
    // Bottom-center stack. The container ignores pointer events so it never
    // blocks the canvas behind it; each toast re-enables them for its buttons.
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1001] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const badge = TYPE_BADGE[toast.type];
        return (
          <div
            key={toast.id}
            className="glass-bevel animate-toast-in pointer-events-auto relative flex items-center gap-2.5 max-w-[90vw] py-2.5 pl-2.5 pr-3.5 rounded-[14px] border border-black/60 text-sm text-text-primary"
            style={{
              background: 'var(--color-surface)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow:
                '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.2), 0 16px 32px rgba(0, 0, 0, 0.28)',
            }}
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${badge.className}`}>
              <Icon name={badge.icon} className="w-3 h-3" />
            </span>
            <span className="leading-snug">{toast.message}</span>
            {toast.actionLabel && toast.onAction && (
              <button
                className="ml-1 shrink-0 px-2.5 py-1 text-xs font-medium rounded-full bg-white/[0.08] hover:bg-white/[0.12] active:bg-white/[0.05] transition-colors duration-150 [-webkit-app-region:no-drag]"
                onClick={() => {
                  toast.onAction?.();
                  removeToast(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            {toast.persistent && (
              <button
                className="ml-0.5 shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-text-tertiary hover:text-text-secondary hover:bg-white/[0.06] active:bg-white/[0.03] transition-colors duration-150 [-webkit-app-region:no-drag]"
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss"
              >
                <Icon name="x" className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
