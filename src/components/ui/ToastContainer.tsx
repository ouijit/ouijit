import { createPortal } from 'react-dom';
import { useProjectStore } from '../../stores/projectStore';

export function ToastContainer() {
  const toasts = useProjectStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return createPortal(
    <>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`fixed bottom-6 left-1/2 text-text-primary px-4 py-2 rounded-md border shadow-lg text-sm font-medium z-[1001] flex items-center gap-2 transition-all duration-200 ease-out opacity-100 before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:shrink-0 ${
            toast.type === 'success'
              ? 'border-[rgba(48,209,88,0.4)] bg-[rgba(48,209,88,0.12)] before:bg-[#30D158]'
              : toast.type === 'error'
                ? 'border-[rgba(255,69,58,0.4)] bg-[rgba(255,69,58,0.12)] before:bg-[#FF453A]'
                : 'border-border'
          }`}
          style={{
            background: toast.type === 'success' || toast.type === 'error' ? undefined : 'rgba(44, 44, 46, 0.9)',
            transform: 'translateX(-50%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {toast.message}
        </div>
      ))}
    </>,
    document.body,
  );
}
