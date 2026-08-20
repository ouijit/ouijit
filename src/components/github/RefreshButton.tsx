import { useEffect, useRef, useState } from 'react';
import { Icon } from '../terminal/Icon';

/** Minimum spin, so a refresh that returns instantly still shows as one. */
const MIN_SPIN_MS = 450;

interface RefreshButtonProps {
  busy: boolean;
  onClick: () => void;
  /** Pass empty where a surrounding tooltip already names the button. */
  title?: string;
}

/**
 * A warm `gh` call can return inside a frame, so the spin is held past the
 * response rather than flashing.
 */
export function RefreshButton({ busy, onClick, title = 'Refresh' }: RefreshButtonProps) {
  const [spinning, setSpinning] = useState(busy);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (busy) {
      startedAt.current = Date.now();
      setSpinning(true);
      return;
    }
    if (!spinning) return;
    const elapsed = startedAt.current == null ? MIN_SPIN_MS : Date.now() - startedAt.current;
    const remaining = Math.max(0, MIN_SPIN_MS - elapsed);
    const timer = setTimeout(() => setSpinning(false), remaining);
    return () => clearTimeout(timer);
  }, [busy, spinning]);

  return (
    <button
      type="button"
      // Not disabled while spinning: a second press is a legitimate ask for
      // fresher data.
      className="w-7 h-7 rounded-md text-text-secondary flex items-center justify-center transition-all duration-150 hover:bg-ink/10 hover:text-text-primary"
      title={title || undefined}
      // Always labelled: wrapped in a tooltip it has no title, and a glyph-only
      // button has no other accessible name.
      aria-label="Refresh"
      aria-busy={spinning}
      onClick={onClick}
    >
      <span
        className="flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4"
        style={spinning ? { animation: 'loading-dot-spin 0.8s linear infinite' } : undefined}
      >
        <Icon name="arrows-clockwise" />
      </span>
    </button>
  );
}
