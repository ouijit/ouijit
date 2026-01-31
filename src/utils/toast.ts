/**
 * Toast notification utility
 * Extracted from importDialog.ts for wider use
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Shows a simple toast notification
 */
export function showToast(message: string, type: ToastType = 'success'): void {
  // Remove any existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
  });

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}
