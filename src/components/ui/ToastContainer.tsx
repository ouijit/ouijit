import { createPortal } from 'react-dom';
import { useProjectStore } from '../../stores/projectStore';

export function ToastContainer() {
  const toasts = useProjectStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return createPortal(
    <>
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.type} toast--visible`}>
          {toast.message}
        </div>
      ))}
    </>,
    document.body,
  );
}
