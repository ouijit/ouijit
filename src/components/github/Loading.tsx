/**
 * The panel's loading state: one centered ring.
 *
 * Same spinner the terminal cards and kanban cards already use, so a wait in
 * this panel looks like a wait anywhere else in the app.
 */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center py-16" role="status" aria-label={label}>
      <span
        className="w-8 h-8 rounded-full border-[3px] border-ink/15 border-t-ink/50"
        style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
      />
    </div>
  );
}
